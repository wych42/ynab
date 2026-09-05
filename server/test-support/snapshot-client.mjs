/** Opt-in client for ordinary HTTP scenarios. Protocol tests must use the raw client. */
export function snapshotClient(client) {
  const rawCall = typeof client === "function" ? client : client.call.bind(client);
  return async (method, url, body) => {
    const pathname = new URL(url, "http://test.local").pathname;
    const categoryWrite = /^\/api\/(categories|category-groups)(\/|$)/.test(pathname);
    const ledgerWrite = /^\/api\/(accounts|transactions|transfers|reconcile)(\/|$)/.test(pathname);
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method) || (!categoryWrite && !ledgerWrite) ||
      (body !== undefined && (body === null || typeof body !== "object" || Array.isArray(body)))) {
      return rawCall(method, url, body);
    }
    const field = categoryWrite ? "expectedCategoryRevision" : "expectedRevision";
    // Even an explicit undefined/null signals a protocol assertion; never repair it.
    if (body && Object.hasOwn(body, field)) return rawCall(method, url, body);
    const snapshot = await rawCall("GET", "/api/bootstrap");
    if (snapshot.status !== 200) throw new Error(`Fixture bootstrap failed: ${snapshot.status}`);
    const revision = categoryWrite ? snapshot.json.categoryRevision : snapshot.json.ledgerRevisions;
    if (revision == null) throw new Error(`Fixture bootstrap omitted ${field}`);
    return rawCall(method, url, { ...body, [field]: revision });
  };
}
