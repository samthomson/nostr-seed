import NDK, { NDKPrivateKeySigner, NDKEvent, NDKUser, NDKRelay } from '@nostr-dev-kit/ndk'
import { nip19 } from 'nostr-tools'
import * as dotenv from 'dotenv'

// Load environment variables from .env file
dotenv.config()

interface NostrIdentity {
	signer: NDKPrivateKeySigner
	user: NDKUser
}

// Reduced numbers for testing
const TOTAL_REPLIES = 20
const REPLY_TO_TOP_PROB = 0.8 // 80% replies to top note
const PUBLISH_DELAY_MS = 500

const getProfileImageUrl = (pubkey: string) =>
	`https://api.dicebear.com/7.x/identicon/svg?seed=${pubkey}`

const createNostrIdentity = (): NostrIdentity => {
	const signer = NDKPrivateKeySigner.generate()
	const user = new NDKUser({ pubkey: signer.pubkey })
	console.log(`Created identity with pubkey: ${user.pubkey}`)
	return { signer, user }
}

const publishProfileMetadata = async (ndk: NDK, identity: NostrIdentity, name: string) => {
	ndk.signer = identity.signer
	const event = new NDKEvent(ndk)
	event.kind = 0 // Metadata event
	event.created_at = Math.floor(Date.now() / 1000)
	event.pubkey = identity.signer.pubkey
	event.tags = []
	event.content = JSON.stringify({
		name,
		picture: getProfileImageUrl(identity.signer.pubkey),
		// about: 'Fake user for Nostr thread simulation.'
	})
	await event.sign()
	console.log(`Publishing profile metadata for ${name} (${identity.signer.pubkey})`)
	await event.publish()
	// Small delay to help relays process
	await new Promise(resolve => setTimeout(resolve, 500))
}

const createNote = async (ndk: NDK, content: string, signer: NDKPrivateKeySigner, replyTo?: NDKEvent): Promise<NDKEvent> => {
	const event = new NDKEvent(ndk)
	event.kind = 1
	event.content = content
	event.created_at = Math.floor(Date.now() / 1000)
	
	if (replyTo) {
		// Proper NIP-10 threading
		event.tags = [
			['e', replyTo.id],  // Reference to immediate parent
			['p', replyTo.pubkey]  // Reference to parent author
		]
		
		// Get the root event if this is a nested reply
		const rootTag = replyTo.getMatchingTags('e').find(tag => tag[3] === 'root')
		const parentRootTag = replyTo.tags.find(t => t[0] === 'e')
		if (rootTag) {
			// If parent has a root tag, use that as our root
			event.tags.push(['e', rootTag[1], '', 'root'])
		} else if (parentRootTag) {
			// If parent has an e tag but no root, parent is replying to root
			event.tags.push(['e', parentRootTag[1], '', 'root'])
		} else {
			// Parent is the root
			event.tags.push(['e', replyTo.id, '', 'root'])
		}
	} else {
		event.tags = []
	}

	// Important: Set signer before signing
	ndk.signer = signer
	event.pubkey = signer.pubkey
	await event.sign()
	
	// Debug log the event structure
	console.log(`Creating note: ${content.substring(0, 30)}...`)
	console.log(`Tags: ${JSON.stringify(event.tags)}`)
	
	return event
}

const connectToRelays = async (ndk: NDK): Promise<void> => {
	console.log('Connecting to relays...')
	try {
		const connectionPromise = ndk.connect()
		const timeoutPromise = new Promise((_, reject) => 
			setTimeout(() => reject(new Error('Connection timeout')), 5000)
		)
		
		await Promise.race([connectionPromise, timeoutPromise])
		console.log('Connected to relays')
	} catch (error) {
		console.log('Warning: Some relays failed to connect:', error.message)
	}
}

const publishEvent = async (ndk: NDK, event: NDKEvent, signer: NDKPrivateKeySigner): Promise<void> => {
	try {
		ndk.signer = signer
		const published = await event.publish()
		
		if (!published) {
			throw new Error('Event was not published to any relays')
		}
		
		const relays = Array.from(published as Set<NDKRelay>)
		if (relays.length === 0) {
			throw new Error('Event published but no relay confirmations received')
		}
		
		const noteNip19 = nip19.noteEncode(event.id)
		console.log(`Published ${event.kind === 1 ? 'note' : 'event'}: "${event.content.substring(0, 30)}..."`)
		console.log(`  nostr:${noteNip19}`)
		console.log(`  to ${relays.length} relays`)
		
		await new Promise(resolve => setTimeout(resolve, PUBLISH_DELAY_MS))
	} catch (error) {
		console.error('Failed to publish note:', error.message)
		throw error
	}
}

const randomSentences = [
	"This is really interesting!",
	"I totally agree with you.",
	"Can you explain more?",
	"Thanks for sharing this.",
	"I hadn't thought of it that way.",
	"What do others think?",
	"That's a great point!",
	"I have a different perspective.",
	"Could you provide a source?",
	"This made my day!",
	"I think this could be improved.",
	"How did you come up with this?",
	"I appreciate your insight.",
	"This is a hot topic lately.",
	"I learned something new today.",
	"Can someone summarize?",
	"I have a question about this.",
	"This is a bit confusing.",
	"I love this community!",
	"Looking forward to more discussions."
];

const createLinearThread = async (ndk: NDK, participants: NostrIdentity[], depth: number) => {
	// Create and publish the top note
	const originalPoster = participants[0]
	const topNote = await createNote(ndk, 'TOP NOTE (Linear Thread)', originalPoster.signer)
	console.log('\nPublishing top note for linear thread...')
	await publishEvent(ndk, topNote, originalPoster.signer)

	let previousNote = topNote
	// Create and publish replies in a linear chain
	console.log('\nPublishing linear chain of replies...')
	for (let i = 1; i <= depth; i++) {
		const participant = participants[Math.floor(Math.random() * participants.length)]
		const randomSentence = randomSentences[Math.floor(Math.random() * randomSentences.length)]
		const replyContent = `linear reply ${i}: ${randomSentence}`
		const reply = await createNote(ndk, replyContent, participant.signer, previousNote)
		await publishEvent(ndk, reply, participant.signer)
		previousNote = reply
		await new Promise(resolve => setTimeout(resolve, 2000))
	}
	return topNote
}

const main = async () => {
	const ndk = new NDK({
		explicitRelayUrls: [
			'wss://relay.damus.io',
			'wss://nos.lol',
			'wss://relay.nostr.band',
			'wss://relay.current.fyi',
			'wss://nostr.fmt.wiz.biz',
			'wss://relay.snort.social',
			'wss://eden.nostr.land',
			'wss://purplepag.es',
			'wss://nostr.wine',
			'wss://nostr.mom',
			'wss://offchain.pub',
			'wss://nostr-pub.wellorder.net',
			'wss://nostr.oxtr.dev'
		],
		enableOutboxModel: false,
		autoConnectUserRelays: false,
	})

	try {
		// Use provided private key or generate new one
		const rootPrivkey = process.env.NOSTR_PRIVATE_KEY
		const rootSigner = rootPrivkey ? 
			new NDKPrivateKeySigner(rootPrivkey) :
			NDKPrivateKeySigner.generate()
		
		// Create participants, with root signer as first participant
		const fakeNames = [
			"Olivia Bennett",
			"Liam Carter",
			"Emma Robinson",
			"Noah Thompson",
			"Ava Mitchell",
			"Elijah Parker",
			"Sophia Turner",
			"Lucas Harris",
			"Mia Edwards",
			"Mason Clark",
			"Isabella Lewis",
			"Logan Walker",
			"Charlotte Young",
			"Ethan King",
			"Amelia Wright",
			"James Scott",
			"Harper Green",
			"Benjamin Baker",
			"Evelyn Hall",
			"Jack Murphy",
			"Ella Foster",
			"William Reed",
			"Grace Morgan",
			"Alexander Brooks",
			"Chloe Wood",
			"Daniel Kelly",
			"Sofia Price",
			"Matthew Bell",
			"Scarlett Cooper",
			"David Bailey",
			"Layla Richardson"
		];
		const participants: NostrIdentity[] = [
			{ signer: rootSigner, user: new NDKUser({ pubkey: rootSigner.pubkey }) },
			...Array.from(
				{ length: fakeNames.length - 1 },
				() => createNostrIdentity()
			)
		]
		
		// Connect to relays
		await connectToRelays(ndk)
		
		// Publish metadata for each participant
		for (let i = 0; i < participants.length; i++) {
			await publishProfileMetadata(ndk, participants[i], fakeNames[i])
		}
		
		// Create branching thread (many replies to top note)
		const originalPoster = participants[0]
		const participantB = participants[1] // Get second participant for A-B thread
		const topNote = await createNote(ndk, 'TOP NOTE (A-B Thread)', originalPoster.signer)
		console.log('\nPublishing top note for branching thread...')
		await publishEvent(ndk, topNote, originalPoster.signer)
		
		// B's initial reply that everyone will reply to
		let previousNote = topNote
		let firstReply = await createNote(ndk, 'First reply from B', participantB.signer, previousNote)
		await publishEvent(ndk, firstReply, participantB.signer)
		previousNote = firstReply
		
		// Create and publish replies
		console.log('\nPublishing alternating A-B replies...')
		for (let i = 1; i <= TOTAL_REPLIES; i++) {
			const participant = i % 2 === 0 ? participantB : originalPoster
			const randomSentence = randomSentences[Math.floor(Math.random() * randomSentences.length)]
			const replyContent = `reply ${i}: ${randomSentence}`
			const reply = await createNote(ndk, replyContent, participant.signer, previousNote)
			await publishEvent(ndk, reply, participant.signer)
			previousNote = reply
			await new Promise(resolve => setTimeout(resolve, 2000))
		}
		
		// Create linear thread
		console.log('\nCreating linear thread...')
		const linearTopNote = await createLinearThread(ndk, participants, 20)
		
		console.log('\nThread creation completed!')
		console.log('Original branching post:')
		const topNoteNip19 = nip19.noteEncode(topNote.id)
		console.log(`  Hex event ID: ${topNote.id}`)
		console.log(`  NIP-19 event ID: ${topNoteNip19}`)
		console.log(`  nostr: URI: nostr:${topNoteNip19}`)
		console.log(`  View on nostr.band: https://nostr.band/event/${topNote.id}`)

		console.log('\nOriginal linear post:')
		const linearTopNoteNip19 = nip19.noteEncode(linearTopNote.id)
		console.log(`  Hex event ID: ${linearTopNote.id}`)
		console.log(`  NIP-19 event ID: ${linearTopNoteNip19}`)
		console.log(`  nostr: URI: nostr:${linearTopNoteNip19}`)
		console.log(`  View on nostr.band: https://nostr.band/event/${linearTopNote.id}`)

		// Wait a bit before exiting to ensure all events are processed
		await new Promise(resolve => setTimeout(resolve, 3000))
	} catch (error) {
		console.error('Script error:', error.message)
		process.exit(1)
	} finally {
		process.exit(0)
	}
}

main() 