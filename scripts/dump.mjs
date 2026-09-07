// Печатает разобранное расписание: сверка парсера с таблицей вручную.
// Использование: node scripts/dump.mjs [класс] [--json]
import { fetchSchedule } from '../lib/sheet.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const only = args.find((a) => !a.startsWith('--'));

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
        const bits = [];
        if (e.teachers.length) bits.push(e.teachers.join(' + '));
        if (e.place) bits.push(`каб. ${e.place}`);
        if (e.note) bits.push(e.note);
        if (e.split) bits.push('ПОДГРУППЫ');
        if (e.secondEnglish) bits.push(`2-я гр. англ. (${e.marker})`);
        else if (e.marker) bits.push(`маркер ${e.marker}`);
        if (e.extra) bits.push('доп. курс');
        if (e.sharedWith.length) bits.push(`вместе с ${e.sharedWith.join(', ')}`);
        console.log(`    ${time} [${e.kind[0]}] ${e.subject}${bits.length ? '  — ' + bits.join('; ') : ''}`);
      }
    }
  }
}
