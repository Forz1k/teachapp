import {isEncryptedBackup,decryptBackup} from '../privacy.js';
import {retentionPreview,purgeExpired} from '../retention.js';
import { validateBackup } from '../backup.js';
/* screens/settings.js — настройки, импорт, экспорт, резервные копии, управление классами. */

import { APP_VERSION } from '../version.js';
import * as M from '../model.js';
import {periodName,periodKinds,periodDraft,gradeLevelOf} from '../assessment.js';
import * as store from '../store.js';
import * as ui from '../ui.js';
import * as exporter from '../export.js';
import { seedDemo } from '../demo.js';

import {openTournaments} from './tournaments.js';
import {openWorkCalendar} from './work-calendar.js';
import {openSelectiveBackup} from './selective-backup.js';
import {openSync} from './sync.js';
import {openInventory,openAchievements} from './resources.js';
import {openDocuments} from './documents.js';
import {openRubrics} from './school-tools.js';
import {openArchive} from './school-archive.js';
import {openLibrary} from './library.js';
import {accents,readAccent,applyAccent,initializeDesign} from '../design.js';
import {dashboardHeading,metric} from '../dashboard.js';
const { el, icon } = ui;

export function renderSettings(root, ctx = {}) {
  const settings = store.state.settings;

  root.append(el('div', { class: 'topbar' }, [
    el('div', { class: 'topbar-row' }, [el('h1', { text: 'Настройки' })]),
  ]));

  const body = el('div', { class:'list settings-directory' });
  root.append(body);
  if(ctx.onAnalytics)body.append(el('div',{class:'card-block'},[el('div',{class:'head',text:'Аналитика и итоговые оценки'}),el('button',{class:'btn wide',type:'button',text:'Открыть аналитику',onclick:ctx.onAnalytics})]));
  if(ctx.onCoach)body.append(el('div',{class:'card-block'},[el('div',{class:'head',text:'Режим тренера'}),el('button',{class:'btn wide',type:'button',text:'Волейбол · команды и тренировки',onclick:ctx.onCoach})]));

  body.append(el('div',{class:'card-block'},[el('div',{class:'head',text:'Методические материалы'}),el('button',{class:'btn wide',type:'button',text:'Библиотека упражнений и конспекты',onclick:()=>openLibrary('school')}),el('button',{class:'btn wide',type:'button',text:'Конструктор оценивания техники',onclick:openRubrics})]));
  body.append(el('div',{class:'card-block'},[el('div',{class:'head',text:'Рабочий календарь'}),el('button',{class:'btn wide',type:'button',text:'Календарь и напоминания',onclick:openWorkCalendar})]));
  body.append(el('div',{class:'card-block'},[el('div',{class:'head',text:'Соревнования'}),el('button',{class:'btn wide',type:'button',text:'Организация соревнований',onclick:openTournaments})]));
  body.append(el('div',{class:'card-block'},[el('div',{class:'head',text:'Генератор документов'}),el('button',{class:'btn wide',type:'button',text:'Word, Excel и PDF',onclick:()=>openDocuments()})]));
  body.append(el('div',{class:'card-block'},[el('div',{class:'head',text:'Спортивный инвентарь и достижения'}),el('button',{class:'btn wide',type:'button',text:'Инвентарь',onclick:openInventory}),el('button',{class:'btn wide',type:'button',text:'Школьные достижения',onclick:()=>openAchievements({area:'school'})})]));
  /* ---------- учебный год ---------- */
  const yearBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'Учебный год' })]);
  const yearFrom = el('input', { type: 'date', value: settings.year.from });
  const yearTo = el('input', { type: 'date', value: settings.year.to });
  yearFrom.addEventListener('change', () => store.setYear(yearFrom.value, yearTo.value));
  yearTo.addEventListener('change', () => store.setYear(yearFrom.value, yearTo.value));
  yearBlock.append(el('div', { style: 'padding:12px 16px' }, [
    el('label', { class: 'field' }, [el('span', { text: 'Начало' }), yearFrom]),
    el('label', { class: 'field', style: 'margin-bottom:0' }, [el('span', { text: 'Окончание' }), yearTo]),
  ]));
  yearBlock.append(el('button',{type:'button',class:'btn wide',text:'Архив и перевод классов',onclick:()=>openArchive(ctx.onChanged)}));
  body.append(yearBlock);

  const trBlock=el('div',{class:'card-block'},[el('div',{class:'head',text:'Учебные периоды · Триместры / Четверти / Полугодия'})]);
  const kind=el('select',{},Object.entries(periodKinds).map(([value,text])=>el('option',{value,text})));
  kind.value=settings.trimesters[0]?.kind||'trimester';
  let draft=settings.trimesters.map(t=>({...t,kind:t.kind||'trimester',name:periodName(t)}));
  const list=el('div');
  function draw(){
    list.replaceChildren();
    for(const p of draft){
      const name=el('input',{value:p.name,'aria-label':'Название периода'});
      const from=el('input',{type:'date',value:p.from,'aria-label':'Начало периода'});
      const to=el('input',{type:'date',value:p.to,'aria-label':'Конец периода'});
      name.oninput=()=>p.name=name.value;from.oninput=()=>p.from=from.value;to.oninput=()=>p.to=to.value;
      list.append(el('div',{class:'card-block'},[name,el('label',{class:'field'},['С',from]),el('label',{class:'field'},['По',to]),
        el('button',{class:'btn',type:'button',text:'Убрать период из черновика',onclick:()=>{draft=draft.filter(x=>x!==p);draw();}})]));
    }
  }
  draw();
  trBlock.append(el('label',{class:'field'},['Тип шаблона',kind]),
    el('button',{class:'btn',type:'button',text:'Создать черновик периодов',onclick:()=>{try{draft=periodDraft(kind.value,settings.year);draw();}catch(err){ui.toast(err.message);}}}),
    el('p',{text:'Границы шаблона примерные. Укажите даты вашей школы и сохраните.'}),list,
    el('button',{class:'btn',type:'button',text:'Добавить свой период',onclick:()=>{draft.push({id:M.uid('period'),kind:'custom',name:'Новый период',from:'',to:''});draw();}}),
    el('button',{class:'btn primary wide',type:'button',text:'Сохранить периоды',onclick:async()=>{try{await store.savePeriods(draft);ui.toast('Периоды сохранены');}catch(err){ui.toast(err.message);}}}));
  body.append(trBlock);

  /* ---------- классы ---------- */
  const clsBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'Классы' })]);
  for (const cls of store.state.classes) {
    const n = store.studentsOfClass(cls.id).length;
    clsBlock.append(el('div', { class: 'row-item' }, [
      el('div', { class: 'label' }, [
        el('div', { text: cls.name + (cls.isDemo ? ' (демо)' : '') }),
        el('div', { style: 'font-size:12px;color:var(--text-3)', text: `${n} учеников · параллель: ${gradeLevelOf(cls)??'не указана'}` }),
      ]),
      el('button', {
        class: 'btn small', type: 'button', text: 'Состав',
        onclick: () => openClassStudents(cls.id),
      }),
      el('button', {
        class: 'btn small', type: 'button', text: '✎',
        onclick: async () => {
          const name = await ui.promptDialog({ title: 'Название класса', value: cls.name });
          if (name === null || !name.trim()) return;
          await store.renameClass(cls.id, name);
        },
      }),
      el('button', {
        class: 'btn small danger', type: 'button', text: '✕',
        onclick: async () => {
          const cnt = store.studentsOfClass(cls.id).length;
          const ok = await ui.confirmDialog({
            title: `Удалить класс ${cls.name}?`,
            text: `Удалятся ${cnt} учеников вместе со всеми оценками, освобождениями и месячными отметками. Отменить это будет нельзя.`,
            ok: 'Удалить', danger: true,
          });
          if (!ok) return;
          await store.deleteClass(cls.id);
          ui.toast('Класс удалён');
        },
      }),
    ]));
  }
  clsBlock.append(el('div', { class: 'row-item' }, [
    el('button', {
      class: 'btn small', type: 'button', text: '+ Добавить класс',
      onclick: async () => {
        const name = await ui.promptDialog({ title: 'Название класса', placeholder: 'например: 9А', ok: 'Добавить' });
        if (name === null || !name.trim()) return;
        await store.addClass(name);
        ui.toast('Класс добавлен');
      },
    }),
  ]));
  body.append(clsBlock);

  /* ---------- КТП ---------- */
  const ktpBlock = el('div', { class: 'card-block' }, [
    el('div', { class: 'head', text: `КТП (${store.state.ktp.length})` }),
  ]);
  ktpBlock.append(el('div', { class: 'row-item' }, [
    el('div', { class: 'label' }, [
      el('div', { text: 'Планы по классам' }),
      el('div', {
        style: 'font-size:12px;color:var(--text-3)',
        text: store.state.ktp.length
          ? store.state.ktp.map((k) => k.name).slice(0, 3).join(', ') + (store.state.ktp.length > 3 ? '…' : '')
          : 'ещё не созданы',
      }),
    ]),
    el('button', {
      class: 'btn small', type: 'button', text: 'Открыть',
      onclick: () => {
        import('./ktp.js').then((m) => m.renderKtpInSheet());
      },
    }),
  ]));
  body.append(ktpBlock);

  /* ---------- импорт ---------- */
  const impBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'Импорт' })]);
  const fileInput = el('input', {
    type: 'file', accept: '.xlsx,.xls,.csv,.tsv', style: 'display:none',
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = '';
    try {
      await handleImport(file);
    } catch (err) {
      ui.toast('Ошибка импорта: ' + err.message, null, 6000);
    }
  });
  impBlock.append(fileInput);

  impBlock.append(el('div', { class: 'row-item' }, [
    el('div', { class: 'label' }, [
      el('div', { text: 'Списки классов из Excel' }),
      el('div', { style: 'font-size:12px;color:var(--text-3)', text: 'Лист = класс, или колонка «Класс»' }),
    ]),
    el('button', {
      class: 'btn small', type: 'button', text: 'Выбрать файл',
      onclick: () => fileInput.click(),
    }),
  ]));
  if (!exporter.hasXlsx()) {
    impBlock.append(el('div', { class: 'row-item' }, [
      el('div', { class: 'label', style: 'color:var(--mark-2);font-size:13px', text: 'Модуль XLSX не загружен — положите vendor/xlsx.full.min.js' }),
    ]));
  }
  body.append(impBlock);

  /* ---------- экспорт ---------- */
  const expBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'Экспорт' })]);
  expBlock.append(el('div', { class: 'row-item' }, [
    el('div', { class: 'label' }, [
      el('div', { text: 'Выгрузка журнала' }),
      el('div', { style: 'font-size:12px;color:var(--text-3)', text: 'Сводная, для «Моей школы», CSV, TSV' }),
    ]),
    el('button', { class: 'btn small', type: 'button', text: 'Открыть', onclick: () => openExportSheet() }),
  ]));
  body.append(expBlock);

  /* ---------- резервная копия ---------- */
  const backupBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'Резервная копия' })]);
  backupBlock.classList.add('settings-backup');
  const lastBackup = store.state.lastBackupAt
    ? `Последняя: ${store.state.lastBackupAt.slice(0, 10)}`
    : 'Ещё не делали';
  backupBlock.append(el('div',{class:'backup-status'},[el('span',{class:'metric-icon'},[icon('shield')]),el('div',{},[el('strong',{text:store.state.lastBackupAt?'Последняя копия: '+store.state.lastBackupAt.slice(0,10):'Резервная копия ещё не создана'}),el('p',{text:'Храните защищённую копию отдельно от устройства.'})])]));
  backupBlock.append(
    el('div', { class: 'row-item' }, [
      el('div', { class: 'label' }, [
        el('div', { text: 'Незашифрованная копия (JSON)' }),
        el('div', { style: 'font-size:12px;color:var(--text-3)', text: lastBackup }),
      ]),
      el('button', {
        class: 'btn small', type: 'button', text: 'Сохранить',
        onclick: async () => {
          try { await exporter.exportBackup(); } catch (err) { ui.toast(err.message); }
        },
      }),
    ]),
  );

  backupBlock.append(el('div',{class:'row-item'},[el('div',{class:'label',text:'Защищённая копия (рекомендуется)'}),el('button',{class:'btn small',type:'button',text:'Создать',onclick:async()=>{
    let password=await ui.promptDialog({title:'Пароль для копии',text:'Не менее 12 символов. Пароль не сохраняется. Без него открыть копию нельзя.',password:true,ok:'Далее'});
    if(password===null)return;
    if(password.length<12){ui.toast('Не менее 12 символов');return;}
    let repeat=await ui.promptDialog({title:'Повторите пароль',password:true,ok:'Шифровать'});
    if(repeat===null)return;
    if(password!==repeat){ui.toast('Пароли не совпадают');return;}
    try{await exporter.exportBackup(password);}catch(e){ui.toast(e.message);}finally{password=repeat=null;}
  }})]));
  const restoreInput = el('input', { type: 'file', accept: '.json', style: 'display:none' });
  restoreInput.addEventListener('change', async () => {
    const file = restoreInput.files?.[0];
    if (!file) return;
    restoreInput.value = '';
    try {
      let payload = await exporter.readBackupFile(file);
      if(isEncryptedBackup(payload)){
        let password=await ui.promptDialog({title:'Пароль защищённой копии',password:true,ok:'Открыть'});
        if(password===null)return;
        try{payload=await decryptBackup(payload,password);}finally{password=null;}
      }
      if(payload.scope)throw Error('Это выборочная копия. Откройте «Выборочная копия / восстановление»');
      const data = validateBackup(payload);
      const ok = await ui.confirmDialog({
        title: 'Заменить все данные TeachApp из копии?',
        text: 'В файле классов: ' + data.classes.length + ', учеников: ' + data.students.length + ', уроков: ' + data.lessons.length
          + ', команд: '+data.coachTeams.length+'. Все текущие школьные и тренерские записи будут заменены. Копия прежнего формата не содержит новых разделов.',
        ok: 'Заменить данные', danger: true,
      });
      if (!ok) return;
      await store.restoreBackup(payload);
      ui.toast('Данные восстановлены');
    } catch (err) {
      ui.toast('Не удалось: ' + err.message, null, 6000);
    }
  });
  const protectedRow=backupBlock.lastElementChild;
  protectedRow.classList.add('backup-recommended');
  const ordinaryRow=protectedRow.previousElementSibling;
  if(ordinaryRow)backupBlock.insertBefore(protectedRow,ordinaryRow);
  backupBlock.append(restoreInput);

  backupBlock.append(el('div', { class: 'row-item' }, [
    el('div', { class: 'label', text: 'Восстановить из копии' }),
    el('button', { class: 'btn small', type: 'button', text: 'Выбрать файл', onclick: () => restoreInput.click() }),
  ]));
  backupBlock.append(el('button',{class:'btn wide',type:'button',text:'Выборочная копия / восстановление',onclick:openSelectiveBackup}));
  backupBlock.append(el('button',{class:'btn wide',type:'button',text:'Синхронизация устройств · бета',onclick:openSync}));
  body.append(backupBlock);
  const diagnostics=el('p',{role:'status',text:'Проверка не меняет данные и ничего не отправляет.'});
  body.append(el('div',{class:'card-block'},[el('div',{class:'head',text:'Диагностика базы'}),diagnostics,el('button',{class:'btn wide',type:'button',text:'Проверить целостность и хранилище',onclick:async e=>{
    const button=e.currentTarget;button.disabled=true;
    try{const payload=await store.makeBackup();validateBackup(payload);
      let storage='';try{const estimate=await navigator.storage?.estimate?.();if(estimate&&Number.isFinite(estimate.usage)&&Number.isFinite(estimate.quota))storage=' · Хранилище: '+Math.round(estimate.usage/1048576)+' / '+Math.round(estimate.quota/1048576)+' МБ (оценка браузера)';}catch{}
      diagnostics.textContent='Структура и связи корректны · записей '+Object.values(payload.data).reduce((n,a)=>n+a.length,0)+storage;
    }catch{diagnostics.textContent='Проверка не пройдена. Не удаляйте приложение и не очищайте хранилище. Сохраните защищённую копию для диагностики.';}finally{button.disabled=false;}
  }})]));
  const retention=el('input',{type:'number',min:0,max:3650,step:1,value:settings.retentionDays??0});
  body.append(el('div',{class:'card-block'},[el('div',{class:'head',text:'Конфиденциальность и сроки хранения'}),
    el('p',{text:'Экранная ширма не заменяет пароль устройства. Данные IndexedDB не шифруются. Срок действует только для истёкших сведений об ограничениях и группах; 0 — срок не задан. Автоматического удаления нет.'}),
    el('label',{class:'field'},['Хранить после окончания действия, дней',retention]),
    el('button',{class:'btn wide',type:'button',text:'Сохранить срок',onclick:async()=>{
      const days=Number(retention.value);if(retention.value===''||!Number.isInteger(days)||days<0||days>3650)return ui.toast('Введите 0–3650 дней');
      try{await store.saveSettings({retentionDays:days});ui.toast('Срок сохранён');}catch{ui.toast('Не удалось сохранить срок');}
    }}),
    el('button',{class:'btn wide danger',type:'button',text:'Проверить и удалить истёкшие сведения',onclick:async()=>{
      try{
        const days=store.state.settings.retentionDays||0,plan=await retentionPreview(days);
        const message='До '+plan.cutoff+': групп '+plan.profiles+', школьных ограничений '+plan.restrictions+', тренерских ограничений '+plan.coach+'. Оценки, отметки участия, справки ОСВ и результаты сохраняются. Сделайте защищённую резервную копию заранее.';
        if(!plan.profiles&&!plan.restrictions&&!plan.coach){ui.toast('Истёкших сведений для удаления нет');return;}
        if(await ui.confirmDialog({title:'Удалить истёкшие сведения?',text:message,ok:'Удалить',danger:true})){await purgeExpired(days,true,plan);ui.toast('Истёкшие сведения удалены');}
      }catch(e){ui.toast(e.message);}
    }})]));

  /* ---------- демо-данные ---------- */
  const demoBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'Демонстрационные данные' })]);
  const demoDesc = el('div', {
    style: 'padding:12px 16px 0;font-size:13px;color:var(--text-2);line-height:1.45',
    text: '3 класса по 30 учеников, темы КТП по физкультуре и заполненные уроки. Помечаются как демо и удаляются одной кнопкой — реальный журнал они не затрагивают.',
  });
  demoBlock.append(demoDesc);
  demoBlock.append(el('div', { class: 'row-item', style: 'border-top:0;margin-top:8px' }, [
    el('div', { class: 'label', text: 'Загрузить демо-данные' }),
    el('button', {
      class: 'btn small primary', type: 'button', text: 'Загрузить',
      onclick: async () => {
        const ok = await ui.confirmDialog({
          title: 'Загрузить демо?',
          text: 'К существующим данным добавятся 3 демо-класса. Затем их можно удалить кнопкой «Стереть демо».',
          ok: 'Загрузить',
        });
        if (!ok) return;
        ui.toast('Готовим демо-данные…', null, 2000);
        const res = await seedDemo({});
        ui.toast(`Загружено: ${res.classes} класса, ${res.students} учеников, ${res.lessons} уроков`, null, 5000);
        ctx.onChanged?.();
      },
    }),
  ]));
  demoBlock.append(el('div', { class: 'row-item' }, [
    el('div', { class: 'label' }, [
      el('div', { text: 'Стереть демо-данные' }),
      el('div', { style: 'font-size:12px;color:var(--text-3)', text: store.hasDemo() ? 'Демо-классы есть' : 'Демо-классов нет' }),
    ]),
    el('button', {
      class: 'btn small danger', type: 'button', text: 'Стереть',
      onclick: async () => {
        if (!store.hasDemo()) { ui.toast('Демо-классов нет'); return; }
        const ok = await ui.confirmDialog({
          title: 'Стереть демо?',
          text: 'Удалятся только классы, помеченные как демонстрационные, вместе с их уроками и отметками.',
          ok: 'Стереть', danger: true,
        });
        if (!ok) return;
        const n = await store.clearDemo();
        ui.toast(`Удалено классов: ${n}`);
        ctx.onChanged?.();
      },
    }),
  ]));
  body.append(demoBlock);

  /* ---------- оформление и о программе ---------- */
  const themeBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'Оформление' })]);
  const themeSeg = el('div', { class: 'segmented', style: 'margin:12px 16px' },
    [
      { id: 'auto', label: 'Как в системе' },
      { id: 'light', label: 'Светлая' },
      { id: 'dark', label: 'Тёмная' },
    ].map((t) => el('button', {
      type: 'button', class: settings.theme === t.id ? 'active' : '', text: t.label,
      onclick: () => {
        store.saveSettings({ theme: t.id });
        applyTheme(t.id);
        ctx.onChanged?.();
      },
    })));
  const accentSelect=el('select',{'aria-label':'Цвет оформления'},Object.entries(accents).map(([value,text])=>el('option',{value,text})));
  accentSelect.value=readAccent();
  accentSelect.onchange=()=>applyAccent(accentSelect.value,document.documentElement);
  themeBlock.append(themeSeg,el('label',{class:'field',style:'margin:12px 16px'},[el('span',{text:'Акцент'}),accentSelect]));
  body.append(themeBlock);

  const aboutBlock = el('div', { class: 'card-block' }, [el('div', { class: 'head', text: 'О приложении' })]);
  aboutBlock.append(el('div', {
    style: 'padding:14px 16px;font-size:13px;color:var(--text-2);line-height:1.55',
    html: 'Учитель физкультуры и волейбольный тренер. Основные данные хранятся локально (IndexedDB). '
      + 'Публичный портал и бета-синхронизация подключаются отдельно; публикация выключена по умолчанию. Основной кабинет работает офлайн.<br><br>'
      + `Версия ${APP_VERSION} · записей в базе: ${store.state.students.length + store.state.marks.length + store.state.lessons.length}`,
  }));
  aboutBlock.append(el('div',{class:'about-credit'},[el('span',{text:'Разработано Forzik'}),el('a',{href:'https://github.com/Forz1k/teachapp',target:'_blank',rel:'noopener noreferrer',text:'GitHub проекта ↗'})]));
  body.append(aboutBlock);

  organizeSettings(body);
}

/** Применяет тему к документу. */
export function applyTheme(theme) {
  const root = document.documentElement;
  initializeDesign(root);
  if (theme === 'auto') {
    root.removeAttribute('data-theme');
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) root.setAttribute('data-theme', 'dark');
    else root.setAttribute('data-theme', 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const dark = root.getAttribute('data-theme') === 'dark';
    meta.setAttribute('content', dark ? '#0D1422' : '#F4F6FA');
  }
}

/* ---------- состав класса ---------- */

function openClassStudents(classId) {
  const cls = store.state.classes.find((c) => c.id === classId);
  const students = store.studentsOfClass(classId);

  const sheet = el('div', {}, [
    el('h2', { text: cls ? cls.name : 'Класс' }),
    el('div', { class: 'sub', text: `${students.length} учеников` }),
  ]);

  const level=el('select',{},[el('option',{value:'',text:'Автоматически из названия'}),...Array.from({length:11},(_,i)=>el('option',{value:String(i+1),text:(i+1)+' класс'}))]);
  level.value=cls?.gradeLevel==null?'':String(cls.gradeLevel);
  const groups={};
  sheet.append(el('label',{class:'field'},['Параллель для нормативов',level]),el('p',{text:'Категории задаются вручную или из явного столбца «Пол» при импорте. По ФИО не определяются.'}));
  const list = el('div', { class: 'preview-list norm-group-list' });
  for (const st of students) {
    const group=el('select',{},[el('option',{value:'',text:'Не указана'}),el('option',{value:'boys',text:'Мальчик'}),el('option',{value:'girls',text:'Девочка'})]);
    group.value=st.normGroup||'';group.setAttribute('aria-label','Категория нормативов: '+st.fullName);
    group.onchange=()=>groups[st.id]=group.value||null;
    const row = el('div', { class: 'preview-item' }, [
      el('div', { class: 'txt', text: `${st.number ?? '—'}. ${st.fullName}` }),
      el('button', {
        class: 'btn small', type: 'button', text: '✎',
        onclick: async (e) => {
          e.stopPropagation();
          const name = await ui.promptDialog({ title: 'ФИО', value: st.fullName });
          if (name === null) return;
          await store.updateStudent(st.id, { fullName: name.trim() || st.fullName });
          ui.closeSheet();
        },
      }),
      el('button', {
        class: 'btn small danger', type: 'button', text: '✕',
        onclick: async (e) => {
          e.stopPropagation();
          const ok = await ui.confirmDialog({
            title: `Удалить ${M.shortName(st.fullName)}?`,
            text: 'Вместе с учеником удалятся все его отметки.',
            ok: 'Удалить', danger: true,
          });
          if (!ok) return;
          await store.deleteStudent(st.id);
          ui.closeSheet();
        },
      }),
    ]);
    list.append(el('div',{class:'norm-group-row'},[row,group]));
  }
  sheet.append(list,el('button',{class:'btn primary wide',type:'button',text:'Сохранить параллель и категории',onclick:async()=>{
    try{await store.setClassNormLevel(classId,level.value?Number(level.value):null);await store.saveNormGroups(classId,groups);ui.toast('Категории нормативов сохранены');ui.closeSheet();}catch(e){ui.toast(e.message);}
  }}));

  const nameInput = el('input', { type: 'text', placeholder: 'Фамилия Имя Отчество' });
  const newGroup=el('select',{},[el('option',{value:'',text:'Не указана'}),el('option',{value:'boys',text:'Мальчик'}),el('option',{value:'girls',text:'Девочка'})]);
  sheet.append(
    el('label', { class: 'field', style: 'margin-top:8px' }, [el('span', { text: 'Добавить ученика' }), nameInput]),el('label',{class:'field'},['Категория нормативов',newGroup]),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn primary wide', type: 'button', text: 'Добавить',
        onclick: async () => {
          const v = nameInput.value.trim();
          if (!v) { ui.toast('Введите ФИО'); return; }
          await store.addStudent(classId, v, students.length + 1,newGroup.value||null);
          ui.closeSheet();
          ui.toast('Ученик добавлен');
        },
      }),
    ]),
  );

  ui.openSheet(sheet);
}

/* ---------- импорт ---------- */

async function handleImport(file) {
  const parsed = await exporter.parseRosterFile(file);
  if (!parsed.length) {
    ui.toast('В файле не найдено ни одного класса с учениками', null, 5000);
    return;
  }

  const sheet = el('div', {}, [
    el('h2', { text: 'Импорт списков' }),
    el('div', { class: 'sub', text: 'Проверьте, что распознано верно, затем подтвердите' }),
  ]);

  const list = el('div', { class: 'preview-list' });
  const items = parsed.map((p) => ({ ...p, checked: true }));
  const renderItems = () => {
    list.innerHTML = '';
    for (const p of items) {
      const dup = exporter.findDuplicates(p.students);
      const cb = el('div', { class: `checkbox ${p.checked ? 'on' : ''}` }, [icon('check')]);
      const row = el('div', { class: 'preview-item' }, [
        cb,
        el('div', { class: 'txt' }, [
          el('div', { text: `${p.className} — ${p.students.length} учеников`, style: 'font-weight:600' }),
          dup.length ? el('div', { style: 'font-size:12px;color:var(--mark-3)', text: `Дубликаты ФИО: ${dup.slice(0, 3).join(', ')}${dup.length > 3 ? '…' : ''}` }) : null,
        ]),
      ]);
      row.addEventListener('click', () => { p.checked = !p.checked; renderItems(); });
      list.append(row);
    }
  };
  renderItems();
  sheet.append(list);

  sheet.append(el('div', {
    style: 'font-size:12px;color:var(--text-3);line-height:1.45;margin-bottom:10px',
    text: 'Если ученик с таким ФИО уже есть в классе, обновятся только номер и имя — оценки сохранятся. Новые ученики добавятся.',
  }));

  sheet.append(el('div', { class: 'actions' }, [
    el('button', {
      class: 'btn primary wide', type: 'button', text: 'Импортировать',
      onclick: async (event) => {
        const chosen = items.filter((i) => i.checked);
        if (!chosen.length) { ui.toast('Ничего не выбрано'); return; }
        event.currentTarget.disabled = true;
        ui.closeSheet();
        ui.toast('Импортирую…', null, 2000);
        try {
          const report = await exporter.applyRoster(chosen);
          ui.toast(`Готово: классов ${report.classes}, добавлено ${report.added}, обновлено ${report.updated}, пропущено совпадений ${report.skipped}`, null, 6000);
        } catch {
          ui.toast('Импорт прерван. Проверьте состав класса и повторите импорт.');
        }
      },
    }),
    el('button', { class: 'btn wide', type: 'button', text: 'Отмена', onclick: ui.closeSheet }),
  ]));

  ui.openSheet(sheet);
}

/* ---------- экспорт ---------- */

export function openExportSheet(presetClassId = null) {
  const classes = store.state.classes;
  if (!classes.length) { ui.toast('Сначала добавьте класс'); return; }

  const classId = presetClassId || store.state.currentClassId || classes[0].id;
  const tr = store.currentTrimester();

  const classSelect = el('select', {});
  for (const c of classes) {
    const o = el('option', { value: c.id, text: c.name });
    if (c.id === classId) o.selected = true;
    classSelect.append(o);
  }

  const fromInput = el('input', { type: 'date', value: tr.from });
  const toInput = el('input', { type: 'date', value: tr.to });

  const rangeChips = el('div', { class: 'preset-chips' },
    store.state.settings.trimesters.map((t) => el('button', {
      type: 'button', class: t.id === store.state.currentTrimesterId ? 'active' : '', text: periodName(t),
      onclick: (e) => {
        fromInput.value = t.from;
        toInput.value = t.to;
        rangeChips.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
      },
    })).concat([
      el('button', {
        type: 'button', text: 'весь год',
        onclick: (e) => {
          fromInput.value = store.state.settings.year.from;
          toInput.value = store.state.settings.year.to;
          rangeChips.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          e.currentTarget.classList.add('active');
        },
      }),
    ]));

  const sheet = el('div', {}, [
    el('h2', { text: 'Выгрузить журнал' }),
    el('div', { class: 'sub', text: 'Выберите класс и период' }),
    el('label', { class: 'field' }, [el('span', { text: 'Класс' }), classSelect]),
    el('div', { class: 'sub', style: 'margin-bottom:0', text: 'Период' }),
    rangeChips,
    el('label', { class: 'field', style: 'margin-top:12px' }, [el('span', { text: 'С даты' }), fromInput]),
    el('label', { class: 'field' }, [el('span', { text: 'По дату' }), toInput]),
  ]);

  const actions = el('div', { class: 'actions' });
  const includeExemptions=el('input',{type:'checkbox'});
  sheet.append(el('label',{class:'field'},['Включить отметки ОСВ (только при необходимости)',includeExemptions]));
  const params = () => ({ includeMonthly: false,includeExemptions:includeExemptions.checked, classId: classSelect.value, from: fromInput.value, to: toInput.value });

  actions.append(el('button', {
    class: 'btn primary wide', type: 'button', text: 'Скопировать как TSV (для Google Таблиц)',
    onclick: async () => {
      const { ok } = await exporter.copyTsvSummary(params());
      if (ok) showTsvHelp();
      else ui.toast('Не удалось скопировать — попробуйте выгрузку файлом', null, 5000);
    },
  }));

  actions.append(el('button', {
    class: 'btn wide', type: 'button', text: 'XLSX: сводная ведомость',
    onclick: () => {
      try {
        const name = exporter.exportXlsxSummary(params());
        ui.toast(`Начато скачивание ${name}`);
      } catch (e) { ui.toast('Ошибка: ' + e.message); }
    },
  }));

  actions.append(el('button', {
    class: 'btn wide', type: 'button', text: 'XLSX: для ГИС «Моя школа» (плоская)',
    onclick: () => {
      try {
        const name = exporter.exportXlsxFlat(params());
        ui.toast(`Начато скачивание ${name}`);
      } catch (e) { ui.toast('Ошибка: ' + e.message); }
    },
  }));

  actions.append(el('button', {
    class: 'btn wide', type: 'button', text: 'CSV (резервный вариант)',
    onclick: () => {
      const name = exporter.exportCsvSummary(params());
      ui.toast(`Начато скачивание ${name}`);
    },
  }));

  sheet.append(actions);

  if (ui.isStandalone()) {
    sheet.append(el('div', {
      class: 'compare-line',
      style: 'margin-top:14px;font-size:12px',
      text: 'Вы открыли приложение с экрана «Домой». Если файл не сохраняется, откройте приложение в Safari или используйте копирование в буфер.',
    }));
  }

  ui.openSheet(sheet);
}

/** Инструкция из трёх шагов для вставки в Google Таблицы. */
function showTsvHelp() {
  const sheet = el('div', {}, [
    el('h2', { text: 'Скопировано' }),
    el('div', { class: 'sub', text: 'Данные в буфере обмена — как вставить в Google Таблицы' }),
    el('div', { class: 'compare-line', html:
      '<b>1.</b> Откройте свою таблицу в приложении Google Таблицы.<br>'
      + '<b>2.</b> Выберите ячейку, с которой начнётся вставка (например, A1).<br>'
      + '<b>3.</b> Долгое нажатие → «Вставить». Столбцы и строки разложатся сами.',
    }),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn primary wide', type: 'button', text: 'Понятно', onclick: ui.closeSheet }),
    ]),
  ]);
  ui.openSheet(sheet);
}

/** Keep original controls and handlers; group them without rebuilding inputs. */
export function organizeSettings(body){
 const groups=[{name:'Рабочие инструменты',id:'tools',match:/Аналитика|Режим тренера|Методические|Рабочий календарь|Соревнования|Генератор документов|Спортивный инвентарь/},{name:'Учебный год и классы',id:'school',match:/Учебный год|Учебные периоды|^Классы$|КТП/},{name:'Данные и безопасность',id:'data',match:/^Импорт$|^Экспорт$|Резервная копия|Диагностика базы|Конфиденциальность|Демонстрационные/},{name:'Приложение',id:'app',match:/Оформление|О приложении/}];
 const cards=[...body.children],sections=[];
 for(const g of groups){const list=cards.filter(c=>g.match.test(c.querySelector('.head')?.textContent||''));if(!list.length)continue;const section=el('section',{class:'settings-group','data-group':g.id},[dashboardHeading(g.name),...list]);sections.push(section);}
 const extras=cards.filter(c=>!sections.some(s=>s.contains(c)));if(extras.length)sections.push(el('section',{class:'settings-group'},extras));
 const search=el('input',{type:'search',placeholder:'Найти настройку','aria-label':'Найти настройку'}),empty=el('p',{class:'empty',text:'Настройки не найдены',hidden:true});
 const nav=el('div',{class:'settings-nav'},groups.map(g=>el('button',{type:'button',class:'chip',text:g.name,onclick:()=>{search.value='';filter();sections.find(s=>s.dataset.group===g.id)?.scrollIntoView({behavior:'auto',block:'start'});}})));
 function filter(){const q=search.value.trim().toLocaleLowerCase('ru');let n=0;for(const section of sections){let visible=0;for(const c of section.querySelectorAll(':scope > .card-block')){c.hidden=!!q&&!c.textContent.toLocaleLowerCase('ru').includes(q);if(!c.hidden){visible++;n++;}}section.hidden=!!q&&!visible;}empty.hidden=!q||n>0;}
 search.oninput=filter;
 body.replaceChildren(search,nav,...sections,empty);
}
