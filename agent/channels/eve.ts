/**
 * The framework channel is the only ingress: every session route runs the app
 * bridge's auth walk, and the generic anonymous API stays closed.
 */
import { eveChannel } from 'eve/channels/eve';
import { bridgeAuth } from '../lib/auth';

// One turn at a time per durable session: a retried delivery for an epoch
// queues behind the turn already investigating it instead of steering it.
export default eveChannel({ auth: [bridgeAuth()], turnPolicy: 'queue' });
