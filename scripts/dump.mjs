// Печатает разобранное расписание: сверка парсера с таблицей вручную.
// Использование: node scripts/dump.mjs [класс] [--json]
import { fetchSchedule } from '../lib/sheet.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const only = args.find((a) => !a.startsWith('--'));

const place = (t) => (t.teacher ? ` — ${t.teacher}` : '') + (t.place ? `, каб. ${t.place}` : '');

const data = await fetchSchedule();

if (asJson) {
  console.log(JSON.stringify(data, null, 2));
} else {
  console.log('Классы:', data.classes.map((c) => `${c.id} (${c.title})`).join(', '));
  for (const day of data.days) {
    console.log(`\n=== ${day.title} ===`);
    if (day.notices.length) console.log('  ! ' + day.notices.join(' | '));
    for (const cls of data.classes) {
      if (only && cls.id !== only) continue;
      console.log(`  ${cls.title}:`);
      for (const e of day.byClass[cls.id] || []) {
        const time = [e.start, e.end].filter(Boolean).join('–').padEnd(11);
        const flags = [
          e.paid && 'платное',
          e.double && 'сдвоенный',
          e.secondEnglish && '2-я гр. англ.',
          e.sharedWith.length && `вместе с ${e.sharedWith.join(', ')}`,
          e.note,
        ].filter(Boolean);
        const tail = flags.length ? `  — ${flags.join('; ')}` : '';

        if (e.tracks.length) {
          console.log(`    ${time} ${e.index || ' '} ${e.tracks[0].subject}${place(e.tracks[0])}${tail}`);
          for (const t of e.tracks.slice(1)) {
            console.log(`    ${' '.repeat(11)}   ${t.subject}${place(t)}`);
          }
          continue;
        }

        const who = e.teachers.length ? ` — ${e.teachers.join(' · ')}` : '';
        const room = e.place ? `, каб. ${e.place}` : '';
        const mark = e.kind === 'lesson' ? String(e.index) : e.kind[0];
        console.log(`    ${time} ${mark} ${e.subject}${who}${room}${tail}`);
      }
    }
  }
}
