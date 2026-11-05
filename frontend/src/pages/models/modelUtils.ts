import type { NotFound } from '../../components/LoadError';

/** A model deployment's page, by the backend's model id. */
export const modelPath = (model: { id: string }) => `/models/${encodeURIComponent(model.id)}`;

/** The schemes whose first path segment says where the model is kept (a registry, a bucket), not what it is. */
const LOCATION_FIRST = new Set(['oci', 's3']);

/**
 * A starting point for a new deployment's name, from its model URI: the last path segment, without
 * an OCI tag (`:1.0`) or digest (`@sha256:…`). Empty when the URI names only where models are kept,
 * such as a registry (`oci://registry:5000`) or a bucket (`s3://bucket`), so the field stays for the
 * user to fill rather than starting from a host name.
 */
export const deploymentNameFromUri = (uri: string): string => {
  const match = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(uri.trim());
  if (!match) return '';
  const [, scheme, rest] = match;
  const segments = rest.split('/').filter(Boolean);
  if (segments.length === 0 || (LOCATION_FIRST.has(scheme.toLowerCase()) && segments.length < 2)) return '';
  const last = segments[segments.length - 1];
  return last.split('@')[0].split(':')[0];
};

/** What a model page says when there is no such deployment. */
export const modelNotFound = (id: string): NotFound => ({
  what: 'Model',
  name: id,
  listPath: '/models',
  listLabel: 'Models',
});
