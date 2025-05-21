import NDK, { NDKPrivateKeySigner, NDKEvent, NDKUser, NDKRelay } from '@nostr-dev-kit/ndk'
import { nip19 } from 'nostr-tools'

interface NostrIdentity {
	signer: NDKPrivateKeySigner
	user: NDKUser
}

// Reduced numbers for testing
const TOTAL_PARTICIPANTS = 3
const TOTAL_REPLIES = 5

const createNostrIdentity = (): NostrIdentity => {
	const signer = NDKPrivateKeySigner.generate()
	const user = new NDKUser({ pubkey: signer.pubkey })
	console.log(`Created identity with pubkey: ${user.pubkey}`)
	return { signer, user }
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

const main = async () => {
	const ndk = new NDK({
		explicitRelayUrls: [
			'wss://relay.damus.io',
			'wss://nos.lol',
			'wss://relay.nostr.band',
		],
		enableOutboxModel: false,
		autoConnectUserRelays: false,
	})

	try {
		// Create participants
		console.log(`Creating ${TOTAL_PARTICIPANTS} participants...`)
		const participants: NostrIdentity[] = Array.from(
			{ length: TOTAL_PARTICIPANTS }, 
			() => createNostrIdentity()
		)
		
		// Connect to relays
		await connectToRelays(ndk)
		
		// Create and publish the top note
		const originalPoster = participants[0]
		const topNote = await createNote(ndk, 'TOP NOTE', originalPoster.signer)
		console.log('\nPublishing top note...')
		await publishEvent(ndk, topNote, originalPoster.signer)
		
		// Create a pool of replies
		const replyPool: { participant: NostrIdentity, replyNumber: number }[] = []
		for (let i = 1; i <= TOTAL_REPLIES; i++) {
			// Randomly select a participant for each reply
			const participant = participants[Math.floor(Math.random() * participants.length)]
			replyPool.push({ participant, replyNumber: i })
		}
		
		// Publish replies with delays between them
		console.log('\nPublishing replies...')
		for (const { participant, replyNumber } of replyPool) {
			const reply = await createNote(ndk, `reply ${replyNumber}`, participant.signer, topNote)
			await publishEvent(ndk, reply, participant.signer)
			
			// Add a longer delay between posts (2 seconds)
			await new Promise(resolve => setTimeout(resolve, 2000))
		}
		
		console.log('\nThread creation completed!')
		const topNoteNip19 = nip19.noteEncode(topNote.id)
		console.log('Original post:')
		console.log(`  Hex event ID: ${topNote.id}`)
		console.log(`  NIP-19 event ID: ${topNoteNip19}`)
		console.log(`  nostr: URI: nostr:${topNoteNip19}`)
		console.log(`  View on nostr.band: https://nostr.band/event/${topNote.id}`)
		
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