// Target of the Kubernetes probes (k8s/apps/web.yaml). Answering means the
// server is up. It doesn't call the api on purpose: an api outage must not get
// the web pods restarted or taken out of the Service.
export function GET() {
  return Response.json({ status: "ok" });
}
