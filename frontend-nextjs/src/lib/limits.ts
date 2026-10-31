/**
 * The one message-length number.
 *
 * `backend/api/v1/schemas.py` (`ChatRequest.message`) enforces 1000; the widget
 * advertises the same number as `MAX_MESSAGE_LENGTH` (widget/src/BasjooWidget.tsx) and this is
 * the console's copy. Keeping a second literal in the UI is how the widget came
 * to advertise 2000 while the server rejected at 1000 with `422 string_too_long`.
 * `backend/tests/test_message_length_contract.py` asserts all three agree.
 */
export const MAX_MESSAGE_LENGTH = 1000;
