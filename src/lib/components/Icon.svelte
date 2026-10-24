<script lang="ts">
  export type IconName = 'arrow' | 'back' | 'close' | 'camera' | 'scan' | 'folder' | 'graph' | 'user' | 'sun' | 'check' | 'lock' | 'phone' | 'headset' | 'clock' | 'calendar' | 'bank' | 'copy' | 'tag' | 'bulb' | 'list' | 'document' | 'plus' | 'search' | 'warning' | 'leaf' | 'volume' | 'voicemail' | 'minus' | 'info' | 'trash';
  let { name, size = 20, class: className = '' }: { name: IconName; size?: number; class?: string } = $props();
  const paths: Record<IconName, string> = {
    arrow: 'M5 12h14m-6-6 6 6-6 6', back: 'M19 12H5m6-6-6 6 6 6', close: 'm6 6 12 12M6 18 18 6',
    camera: 'M9 4 7 7H3v13h18V7h-4l-2-3H9ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    scan: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 7h10v10H7V7Zm2 3h6m-6 3h4',
    folder: 'M3 7V4h6l3 3h9v13H3V7Zm0 0h9', graph: 'M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM12 3v6m0 6v6M3 7l6 4m6 2 6 4M3 17l6-4m6-2 6-4M10 3h4M1 7h4m14 0h4M1 17h4m14 0h4m-13 4h4',
    user: 'M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM5 20v-3a7 7 0 0 1 14 0v3H5Z',
    sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
    check: 'm5 12 4 4L19 6', lock: 'M6 10h12v11H6V10Zm2 0V6a4 4 0 0 1 8 0v4m-4 5v2',
    phone: 'M7 3H3c-1 10 8 19 18 18v-4l-5-2-2 2a15 15 0 0 1-7-7l2-2-2-5Z',
    headset: 'M3 14v-3a9 9 0 0 1 18 0v7a3 3 0 0 1-3 3h-4M3 12h4v7H3v-7Zm14 0h4v7h-4v-7Z',
    clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
    calendar: 'M3 5h18v16H3V5Zm4-3v6m10-6v6M3 10h18m-14 4h3m4 0h3m-10 3h3',
    bank: 'm2 8 10-6 10 6H2Zm2 12h16M6 10v7m6-7v7m6-7v7M3 17h18v3H3v-3Z',
    copy: 'M9 9h12v12H9V9ZM5 15H3V3h12v2', tag: 'M9 3 7 21M17 3l-2 18M3 9h18M2 15h18',
    bulb: 'M8 17c0-3-3-4-3-8a7 7 0 0 1 14 0c0 4-3 5-3 8H8Zm0 3h8m-6 3h4',
    list: 'm3 6 1 1 3-3m-4 9 1 1 3-3m-4 9 1 1 3-3M11 6h10m-10 7h10m-10 7h10',
    document: 'M5 2h9l5 5v15H5V2Zm9 0v6h5M8 12h8m-8 4h8', plus: 'M12 5v14M5 12h14',
    search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6',
    warning: 'm12 3 10 18H2L12 3Zm0 6v5m0 3v1', leaf: 'M20 3C8 3 3 8 5 15c7 6 16 0 15-12ZM5 21l10-12',
    volume: 'M3 9h4l5-5v16l-5-5H3V9Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
    voicemail: 'M9 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm14 0a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM5 16h14',
    minus: 'M5 12h14', info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6m0-10v1',
    trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7'
  };
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class={className}><path d={paths[name]} /></svg>
