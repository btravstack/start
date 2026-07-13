// HTTP request scope — a fresh id per request, built with `Layer.forkScope` off the app context
// (see router.ts) and torn down when the request ends.
import { Layer, Tag } from "demesne";

export class RequestId extends Tag("@app/RequestId")<RequestId, { readonly id: string }>() {}

export const RequestScopeLive = Layer.factory(RequestId, () => ({ id: crypto.randomUUID() }));
