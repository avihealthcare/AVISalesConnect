const paths = {
  search: 'M21 21l-4.4-4.4M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  sidebar: 'M4 5h16v14H4zM9 5v14m6-11 3 3-3 3',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0',
  moon: 'M20 15a8.5 8.5 0 0 1-11-11 8.5 8.5 0 1 0 11 11Z',
  sun: 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  chevron: 'm6 9 6 6 6-6',
  gear: 'm9 3-.7 2.1-1.6 1L4.6 6 3 8.6l1.5 1.8v2.1L3 14.4 4.6 17l2.2-.1 1.6 1 .7 2.1h5.8l.7-2.1 1.6-1 2.2.1 1.6-2.6-1.5-1.9v-2.1L21 8.6 19.4 6l-2.2.1-1.6-1-.7-2.1H9Zm6 8.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  filter: 'M3 5h18l-7 8v5l-4 2v-7L3 5Z',
  refresh: 'M20 7v5h-5M4 17v-5h5m-4-2a7 7 0 0 1 11.5-4.5L20 9M4 15l3.5 3.5A7 7 0 0 0 19 14',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16',
  kanban: 'M4 5h4v14H4zM10 5h4v10h-4zM16 5h4v12h-4z',
  split: 'M4 5h16v14H4zM10 5v14',
  add: 'M12 5v14M5 12h14',
  calendar: 'M4 6h16v14H4zM8 4v4m8-4v4M4 10h16',
  camera: 'M4 7h4l2-3h4l2 3h4v13H4zM15.5 13a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  building: 'M3 21h18M6 21V4h10v17m0-11h3v11M9 8h1m2 0h1M9 12h1m2 0h1M9 16h1m2 0h1',
  call: 'M7 4 4 6c0 7 7 14 14 14l2-3-4-3-2 2c-3-1-5-3-6-6l2-2-3-4Z',
} as const;

export function AviIcon({ name,size=16 }: { name:keyof typeof paths;size?:number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]}/></svg>;
}
