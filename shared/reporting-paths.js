export function isReportingPath(path, method = "GET") {
  return (
    (method === "GET" &&
      /^\/api\/(dashboard|social-risk|reporting(?:\/|$)|participation-patterns(?:\/|$)|event-types\/(?:report|export)|analysis\/(?:export|view)|export\/|operations(?:$|\/export)|needs\/(?:overview|programmes|export))/.test(
        path,
      )) ||
    (method === "POST" &&
      /^\/api\/clients\/(report|outreach|priorities|followups)$/.test(path)) ||
    (method === "GET" && /^\/api\/clients\/(export|report)/.test(path))
  );
}
