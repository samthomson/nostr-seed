import NDK, { NDKPrivateKeySigner, NDKEvent, NDKUser, NDKRelay } from '@nostr-dev-kit/ndk'
import { nip19 } from 'nostr-tools'

interface NostrIdentity {
	signer: NDKPrivateKeySigner
	user: NDKUser
}

// Reduced numbers for testing
const TOTAL_REPLIES = 100
const REPLY_TO_TOP_PROB = 0.8 // 80% replies to top note

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
	// Set the signer for this note
	ndk.signer = signer
	
	const event = new NDKEvent(ndk)
	event.kind = 1 // Regular note
	event.content = content
	event.created_at = Math.floor(Date.now() / 1000)
	event.pubkey = signer.pubkey
	
	if (replyTo) {
		// Add proper reply tags
		event.tags = [
			['e', replyTo.id, '', 'root'],  // Root event reference
			['p', replyTo.pubkey]  // Author reference
		]
		console.log(`Creating reply to event ${replyTo.id} by ${replyTo.pubkey}`)
	} else {
		event.tags = []
	}

	// Sign the event
	await event.sign()
	
	// Log the raw event for debugging
	const rawEvent = event.rawEvent()
	console.log('\nRaw event before publishing:', JSON.stringify(rawEvent, null, 2))
	
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
		// Ensure signer is set before publishing
		ndk.signer = signer
		
		// Publish with timeout
		const publishPromise = event.publish()
		const publishTimeoutPromise = new Promise((_, reject) => 
			setTimeout(() => reject(new Error('Publish timeout')), 5000)
		)
		
		const published = await Promise.race([publishPromise, publishTimeoutPromise])
		const noteNip19 = nip19.noteEncode(event.id)
		console.log(`Published note: "${event.content}"`)
		console.log(`  Hex event ID: ${event.id}`)
		console.log(`  NIP-19 event ID: ${noteNip19}`)
		console.log(`  nostr: URI: nostr:${noteNip19}`)
		console.log(`  View on nostr.band: https://nostr.band/event/${event.id}`)
		
		// Show which relays received the event
		const relayUrls = Array.from(published as Set<NDKRelay>).map(relay => relay.url)
		console.log('  Published to relays:', relayUrls.join(', '))
		
		// Add a delay after publishing to ensure relay processing
		await new Promise(resolve => setTimeout(resolve, 2000))
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
		// Assign realistic fake names for demonstration
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
		// Create as many participants as there are names
		const participants: NostrIdentity[] = Array.from(
			{ length: fakeNames.length },
			() => createNostrIdentity()
		)
		
		// Connect to relays
		await connectToRelays(ndk)
		
		// Publish metadata for each participant
		for (let i = 0; i < participants.length; i++) {
			await publishProfileMetadata(ndk, participants[i], fakeNames[i])
		}
		
		// Create branching thread (many replies to top note)
		const originalPoster = participants[0]
		const topNote = await createNote(ndk, 'TOP NOTE (Branching Thread)', originalPoster.signer)
		console.log('\nPublishing top note for branching thread...')
		await publishEvent(ndk, topNote, originalPoster.signer)
		
		// Track all created notes for possible reply targets
		const allNotes: NDKEvent[] = [topNote]
		// Track relay rejections
		const relayRejections: Record<string, number> = {}
		// Create and publish replies
		console.log('\nPublishing branching replies...')
		for (let i = 1; i <= TOTAL_REPLIES; i++) {
			// Pick a participant at random
			const participant = participants[Math.floor(Math.random() * participants.length)]
			// Decide whether to reply to top note or a previous reply
			let parentNote: NDKEvent
			if (Math.random() < REPLY_TO_TOP_PROB || allNotes.length === 1) {
				parentNote = topNote
			} else {
				// Pick a random previous reply as parent
				parentNote = allNotes[Math.floor(Math.random() * (allNotes.length - 1)) + 1]
			}
			// Pick a random sentence
			const randomSentence = randomSentences[Math.floor(Math.random() * randomSentences.length)]
			const replyContent = `reply ${i}: ${randomSentence}`
			const reply = await createNote(ndk, replyContent, participant.signer, parentNote)
			// Publish and track rejections
			try {
				await publishEvent(ndk, reply, participant.signer)
				allNotes.push(reply)
			} catch (err) {
				// Track relay rejections by error message
				const msg = (err && err.message) ? err.message : 'Unknown error'
				relayRejections[msg] = (relayRejections[msg] || 0) + 1
			}
			await new Promise(resolve => setTimeout(resolve, 2000))
		}
		
		// Create linear thread
		console.log('\nCreating linear thread...')
		const linearTopNote = await createLinearThread(ndk, participants, 100)
		
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

		// Print relay rejection summary
		if (Object.keys(relayRejections).length > 0) {
			console.log('\nRelay rejections summary:')
			for (const [reason, count] of Object.entries(relayRejections)) {
				console.log(`  ${reason}: ${count} times`)
			}
		}
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