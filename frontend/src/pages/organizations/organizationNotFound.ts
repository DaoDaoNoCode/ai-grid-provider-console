import type { NotFound } from '../../components/states/NotFoundState';

/** What an organization's page says when the organization doesn't exist. */
export const organizationNotFound = (id: string): NotFound => ({
  what: 'Organization',
  body: `There is no organization ${id}.`,
  listPath: '/organizations',
  listLabel: 'Organizations',
});
