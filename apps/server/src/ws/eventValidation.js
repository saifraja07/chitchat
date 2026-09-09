/**
 * Wraps a Socket.IO event handler with schema validation. Every
 * client-supplied payload goes through here before touching domain
 * logic — invalid payloads never reach a handler.
 *
 * On failure we log and drop the event rather than throwing: a
 * malformed event from a misbehaving or malicious client shouldn't be
 * able to crash the socket or the process. It's cheap for a legitimate
 * client to just retry with a valid payload.
 *
 * Also catches errors thrown by the handler itself (e.g. a Redis
 * hiccup) — without this, an async handler's rejection would become an
 * unhandled promise rejection: the process survives (there's a
 * global handler for that), but the CLIENT never hears back at all,
 * leaving them stuck showing a state that will never resolve. Emitting
 * a generic client-facing error event, when requested, at least gives
 * the client something to react to (e.g. show "something went wrong,
 * try again" instead of an infinite spinner).
 */
export function withValidation(schema, handler, { errorEvent } = {}) {
  return (socket) => (rawPayload) => {
    const result = schema.safeParse(rawPayload ?? {});

    if (!result.success) {
      return;
    }

    Promise.resolve(handler(socket, result.data)).catch((err) => {
      // Unexpected failure inside a handler (e.g. a Redis hiccup) — the
      // only place this is ever surfaced, so it's worth printing rather
      // than swallowing entirely.
      console.error(`Unhandled error in event handler [socket ${socket.id}]:`, err);
      if (errorEvent) {
        socket.emit(errorEvent, { message: 'Something went wrong. Please try again.' });
      }
    });
  };
}
