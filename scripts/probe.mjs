const API = 'https://commons.wikimedia.org/w/api.php';

async function search(q) {
  const p = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${q}`,
    gsrnamespace: '6', gsrlimit: '12',
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '900',
  });
  const r = await fetch(`${API}?${p}`, { headers: { 'User-Agent': 'PetalsApp/1.0 (personal project)' } });
  const j = await r.json();
  const pages = j?.query?.pages ? Object.values(j.query.pages) : [];
  return pages.map(pg => ({
    title: pg.title,
    idx: pg.index,
    url: pg.imageinfo?.[0]?.thumburl,
    w: pg.imageinfo?.[0]?.width,
    h: pg.imageinfo?.[0]?.height,
    mime: pg.imageinfo?.[0]?.mime,
  }));
}

for (const q of ['Paeonia lactiflora flower', 'Protea cynaroides', 'Eucalyptus cinerea foliage']) {
  console.log('===', q);
  const res = await search(q);
  for (const r of res.slice(0, 8)) console.log(` [${r.idx}] ${r.title} ${r.w}x${r.h} ${r.mime}`);
}
