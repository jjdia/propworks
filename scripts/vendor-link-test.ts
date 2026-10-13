import { buildVendorLink, inferCategory, normalizeZip } from '../src/lib/vendorLink';

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${label}`);
  if (cond) pass++; else fail++;
}

const cases: [string, string | null, string][] = [
  ['Kitchen sink leaking', null, 'plumbing'],
  ['Toilet clogged', 'won\'t flush', 'plumbing'],
  ['No hot water', null, 'plumbing'],
  ['No heat', 'radiator cold in bedroom', 'hvac'],
  ['AC not cooling', null, 'hvac'],
  ['Outlet sparks', null, 'electrical'],
  ['Hallway lights out', null, 'electrical'],
  ['Fridge not cold', null, 'appliance'],
  ['Dishwasher leaking', 'water on floor', 'appliance'],
  ['Roaches in kitchen', null, 'pest'],
  ['Mice', 'droppings under the sink', 'pest'],
  ['Front door lock broken', null, 'locksmith'],
  ['Roof leak over bedroom', null, 'roofing'],
  ['Cabinet door hinge', 'loose', 'handyman'],
  ['', '', 'handyman'],
];
for (const [t, d, want] of cases) check(`"${t}${d ? ' / ' + d : ''}" → ${want}`, inferCategory(t, d) === want);

check('zip 5', normalizeZip('11216') === '11216');
check('zip+4 trimmed', normalizeZip('11216-1234') === '11216');
check('zip missing → null', normalizeZip(undefined) === null && normalizeZip('') === null && normalizeZip('abc') === null);

const l = buildVendorLink({ title: 'Kitchen sink leaking', description: 'Under-sink pipe drips' }, { zip: '11216', city: 'Brooklyn', state: 'NY' });
check('url: thumbtack plumbers + zip', l.url === 'https://www.thumbtack.com/k/plumbers/near-me?zip_code=11216');
check('label Plumber', l.label === 'Plumber');
check('description not in URL', !/sink|drip/i.test(l.url));
check('brief has title, description, location', l.brief === 'Kitchen sink leaking\nUnder-sink pipe drips\nLocation: Brooklyn, NY, 11216');

const n = buildVendorLink({ title: 'Wobbly railing' }, null);
check('no property → no zip param, handyman', n.url === 'https://www.thumbtack.com/k/handyman/near-me' && n.zip === null);
check('category override', buildVendorLink({ title: 'Sink' }, { zip: '10001' }, 'handyman').url.includes('/k/handyman/'));
check('https only, thumbtack host', new URL(l.url).protocol === 'https:' && new URL(l.url).host === 'www.thumbtack.com');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
