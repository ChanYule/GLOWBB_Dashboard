// Display-only projection. Imported domain / Event Type labels remain intact.
export function activityDomains(primary, secondary = []) {
  const labels = [], seen = new Set();
  for (const value of [primary, ...(secondary || [])]) {
    for (const part of String(value ?? '').split(/[,&+]/)) {
      const label = part.trim().replace(/\s+/g, ' ');
      const key = label.toLocaleLowerCase('en-SG');
      if (!label || ['unspecified','unclassified / unknown','unknown','missing'].includes(key) || seen.has(key)) continue;
      seen.add(key);
      labels.push(label);
    }
  }
  return labels.length ? labels : ['Unclassified / unknown'];
}
