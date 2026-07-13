// The HTTP host's disposition type `D` (the concrete `D` in the kernel's `DispositionMap<E, D>`):
// an HTTP status + a JSON body. A domain error is translated to one of these at the mount, so no
// status code ever appears inside a handler (invariant B1). Success and the kernel's own
// `ContractError` are handled by fixed rules in the dispatcher; the map covers only domain errors.

import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ApiDisposition = {
  readonly status: ContentfulStatusCode;
  readonly body: unknown;
};

// `api.error(status, body?)` — build a disposition for a domain error. Body defaults to a small
// `{ error }` envelope so a bare `api.error(404)` still returns something meaningful.
export const api = {
  error: (status: ContentfulStatusCode, body?: unknown): ApiDisposition => ({
    status,
    body: body ?? { error: httpReason(status) },
  }),
} as const;

const httpReason = (status: ContentfulStatusCode): string =>
  status === 400
    ? "bad request"
    : status === 404
      ? "not found"
      : status === 409
        ? "conflict"
        : status >= 500
          ? "internal error"
          : "error";
