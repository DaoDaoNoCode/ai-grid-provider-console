// Kubernetes resource quantities (k8s.io/apimachinery pkg/api/resource), as a ManagedCluster's
// status.capacity and status.allocatable carry them: a number with an optional binary (Ki..Ei),
// decimal (k..E) or milli (m) suffix. Exponent forms such as "1e3" are rare in node capacity and
// read as unknown.

const suffixes: Record<string, number> = {
  m: 1e-3,
  '': 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
};

/** The quantity as a number of base units (cores, bytes, devices); undefined when it doesn't parse. */
export const parseQuantity = (quantity: string | undefined): number | undefined => {
  const match = quantity?.trim().match(/^([0-9]+(?:\.[0-9]+)?)(m|k|M|G|T|P|E|Ki|Mi|Gi|Ti|Pi|Ei)?$/);
  if (!match) return undefined;
  return Number(match[1]) * suffixes[match[2] ?? ''];
};

/** At most one decimal, dropped when it is zero: 77.5, 68. */
const oneDecimal = (n: number) => String(Math.round(n * 10) / 10);

/** CPU as cores, for example "68 cores" from "68" or "77.5 cores" from "77500m". */
export const formatCores = (quantity: string | undefined): string | undefined => {
  const cores = parseQuantity(quantity);
  if (cores === undefined) return undefined;
  return `${oneDecimal(cores)} ${cores === 1 ? 'core' : 'cores'}`;
};

/** Memory in GiB, whole from 10 GiB up, for example "261 GiB" from "273509824Ki". */
export const formatGiB = (quantity: string | undefined): string | undefined => {
  const bytes = parseQuantity(quantity);
  if (bytes === undefined) return undefined;
  const gib = bytes / 2 ** 30;
  return `${gib >= 10 ? Math.round(gib) : oneDecimal(gib)} GiB`;
};
