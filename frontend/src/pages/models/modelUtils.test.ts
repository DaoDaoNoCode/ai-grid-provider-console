import { deploymentNameFromUri } from './modelUtils';

describe('deploymentNameFromUri', () => {
  it.each([
    ['hf://org/model', 'model'],
    ['hf://gpt2', 'gpt2'],
    ['hf://org/model/', 'model'],
    ['  hf://org/model  ', 'model'],
    ['oci://quay.io/org/model', 'model'],
    ['oci://quay.io/org/model:1.0', 'model'],
    ['oci://registry/model@sha256:abc123', 'model'],
    ['oci://registry:5000/ns/model:tag@sha256:abc123', 'model'],
    ['oci://registry:5000/ns/model/', 'model'],
    ['s3://bucket/path/model', 'model'],
    ['s3://bucket/path/model/', 'model'],
    ['pvc://claim/path/model', 'model'],
    ['pvc://claim', 'claim'],
  ])('names %s %s', (uri, name) => {
    expect(deploymentNameFromUri(uri)).toBe(name);
  });

  it.each([
    // Only where models are kept: a registry or a bucket names no model.
    'oci://registry:5000',
    'oci://registry:5000/',
    'oci://quay.io',
    's3://bucket',
    's3://bucket/',
    // Not a URI the wizard takes, or nothing after the scheme.
    '',
    'org/model',
    'hf://',
  ])('gives nothing for %s', (uri) => {
    expect(deploymentNameFromUri(uri)).toBe('');
  });
});
