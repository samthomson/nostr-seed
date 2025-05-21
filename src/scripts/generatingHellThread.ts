import NDK, { NDKPrivateKeySigner, NDKEvent, NDKUser, NDKRelay } from '@nostr-dev-kit/ndk'
import { nip19 } from 'nostr-tools'

const main = async () => {
	// Create NDK instance with multiple relays
	const ndk = new NDK({
		explicitRelayUrls: [
			'wss://relay.damus.io',
			'wss://nos.lol',
		],
		enableOutboxModel: false, // Disable outbox to speed up publishing
		autoConnectUserRelays: false, // Don't auto-connect to user relays
	})

	// Generate a new signer
	const signer = NDKPrivateKeySigner.generate()
	ndk.signer = signer

	// Get the public key from the signer
	const user = new NDKUser({ pubkey: signer.pubkey })
	
	console.log('Generated new Nostr identity:')
	console.log(`Private key (hex): ${signer.privateKey}`)
	console.log(`Public key (hex): ${user.pubkey}`)
	console.log(`Public key (npub): ${nip19.npubEncode(user.pubkey)}`)

	// Connect to relays with timeout
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
		// Continue anyway as we might have connected to some relays
	}
	
	// Create a new event (note)
	const event = new NDKEvent(ndk)
	event.kind = 1 // Regular note
	event.content = 'Hello World from Nostr!'
	event.created_at = Math.floor(Date.now() / 1000) // explicit timestamp
	
	// Sign and publish the event
	try {
		await event.sign()  // Sign first
		console.log('\nEvent details before publishing:')
		console.log(JSON.stringify(event.rawEvent(), null, 2))
		
		// Publish with timeout
		const publishPromise = event.publish()
		const publishTimeoutPromise = new Promise((_, reject) => 
			setTimeout(() => reject(new Error('Publish timeout')), 5000)
		)
		
		const published = await Promise.race([publishPromise, publishTimeoutPromise])
		console.log('\nNote published successfully!')
		console.log('Event ID:', event.id)
		console.log('Event URL on nostr.band:', `https://nostr.band/event/${event.id}`)
		
		// Show which relays received the event in a cleaner way
		const relayUrls = Array.from(published as Set<NDKRelay>).map(relay => relay.url)
		console.log('Published to relays:', relayUrls.join(', '))
	} catch (error) {
		console.error('Failed to publish note:', error.message)
	} finally {
		// Force exit as the WebSocket connections might keep the process alive
		process.exit(0)
	}
}

main().catch(error => {
	console.error('Script error:', error.message)
	process.exit(1)
}) 