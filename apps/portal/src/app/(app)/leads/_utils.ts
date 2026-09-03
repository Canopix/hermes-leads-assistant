const FIELD_LABEL_MAP: Record<string, string> = {
  party_size: 'Personas',
  travel_when: 'Cuando viajan',
  destinations: 'Destinos',
  special_needs: 'Necesidades especiales',
}

function snakeToTitleCase(s: string): string {
  return s
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function formatFieldLabel(key: string): string {
  if (FIELD_LABEL_MAP[key]) {
    return FIELD_LABEL_MAP[key]
  }
  return snakeToTitleCase(key)
}
