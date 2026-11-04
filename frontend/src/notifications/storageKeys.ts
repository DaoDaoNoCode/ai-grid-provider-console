// Where the notification center keeps its records in the tab's session storage: one key per
// signed-in user, so a tab another account used never shows or resumes that account's records.

const PREFIX = 'ai-grid-console';

/** The drawer's notifications of this user. */
export const notificationsKey = (owner: string) => `${PREFIX}.notifications.${encodeURIComponent(owner)}`;

/** The write watches of this user. */
export const watchesKey = (owner: string) => `${PREFIX}.write-watches.${encodeURIComponent(owner)}`;

/** What refused creates submitted, for their forms to reopen with. */
export const draftsKey = (owner: string) => `${PREFIX}.write-drafts.${encodeURIComponent(owner)}`;
