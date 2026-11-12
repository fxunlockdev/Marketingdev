-- A chat creative that cannot start says why (for example, a used-up monthly allowance) instead of a
-- bare "could not start". Only the API's own customer-facing refusal text is stored, bounded.
ALTER TABLE delivery.chat_actions ADD COLUMN error_message text CHECK(char_length(error_message)<=300);
