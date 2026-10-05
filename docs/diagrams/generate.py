#!/usr/bin/env python3
"""Generates the business-process diagrams in docs/diagrams (RU + EN). Run: python3 docs/diagrams/generate.py"""
from pathlib import Path
import html


def esc(v):
    return html.escape(str(v), quote=True).replace("'", "&#39;")

OUT = Path(__file__).parent
INK, MUTED, LINE = "#1f2933", "#52606d", "#7b8794"
USDT, TRX, SIGNER = "#0f7a6e", "#b7791f", "#7c3aed"
FONT = "font-family='-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'"


class Svg:
    def __init__(self, w, h, title):
        self.w, self.h, self.title = w, h, title
        self.parts = []

    def box(self, x, y, w, h, title, sub=None, color=INK, fill="#ffffff", bold=True):
        self.parts.append(f"<rect x='{x}' y='{y}' width='{w}' height='{h}' rx='8' fill='{fill}' stroke='{color}' stroke-width='1.5'/>")
        cy = y + h / 2
        if sub:
            self.parts.append(f"<text x='{x + w / 2}' y='{cy - 4}' text-anchor='middle' font-size='13' font-weight='{'600' if bold else '400'}' fill='{color}' {FONT}>{esc(title)}</text>")
            self.parts.append(f"<text x='{x + w / 2}' y='{cy + 14}' text-anchor='middle' font-size='11' fill='{MUTED}' {FONT}>{esc(sub)}</text>")
        else:
            self.parts.append(f"<text x='{x + w / 2}' y='{cy + 5}' text-anchor='middle' font-size='13' font-weight='{'600' if bold else '400'}' fill='{color}' {FONT}>{esc(title)}</text>")

    def arrow(self, x1, y1, x2, y2, label=None, color=LINE, dashed=False, above=True, marker="arrow"):
        dash = " stroke-dasharray='6 4'" if dashed else ""
        self.parts.append(f"<line x1='{x1}' y1='{y1}' x2='{x2}' y2='{y2}' stroke='{color}' stroke-width='1.5'{dash} marker-end='url(#{marker})'/>")
        if label:
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            dy = -8 if above else 16
            self.parts.append(f"<text x='{mx}' y='{my + dy}' text-anchor='middle' font-size='11' fill='{color}' {FONT}>{esc(label)}</text>")

    def path_arrow(self, d, label=None, lx=None, ly=None, color=LINE, dashed=False):
        dash = " stroke-dasharray='6 4'" if dashed else ""
        self.parts.append(f"<path d='{d}' fill='none' stroke='{color}' stroke-width='1.5'{dash} marker-end='url(#arrow)'/>")
        if label:
            self.parts.append(f"<text x='{lx}' y='{ly}' text-anchor='middle' font-size='11' fill='{color}' {FONT}>{esc(label)}</text>")

    def text(self, x, y, s, size=12, color=MUTED, anchor="start", weight="400"):
        self.parts.append(f"<text x='{x}' y='{y}' text-anchor='{anchor}' font-size='{size}' font-weight='{weight}' fill='{color}' {FONT}>{esc(s)}</text>")

    def group_frame(self, x, y, w, h, label, color=LINE):
        self.parts.append(f"<rect x='{x}' y='{y}' width='{w}' height='{h}' rx='12' fill='none' stroke='{color}' stroke-width='1' stroke-dasharray='4 4'/>")
        self.parts.append(f"<text x='{x + 12}' y='{y + 18}' font-size='11' font-weight='600' fill='{color}' {FONT}>{esc(label)}</text>")

    def render(self):
        defs = ("<defs>"
                "<marker id='arrow' viewBox='0 0 10 10' refX='9' refY='5' markerWidth='8' markerHeight='8' orient='auto-start-reverse'>"
                "<path d='M0,0 L10,5 L0,10 z' fill='context-stroke'/></marker></defs>")
        body = "\n".join(self.parts)
        return (f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {self.w} {self.h}' role='img' aria-label='{esc(self.title)}'>\n"
                f"<rect width='{self.w}' height='{self.h}' fill='#ffffff'/>\n{defs}\n"
                f"<text x='24' y='30' font-size='16' font-weight='700' fill='{INK}' {FONT}>{esc(self.title)}</text>\n{body}\n</svg>\n")


L = {
    "ru": dict(
        d1="Кошельки: всё рождается из одной seed‑фразы", phrase="12 или 24 слова", phrase_sub="хранятся только в signer, зашифрованы",
        deposits="Адреса поступлений", deposits_sub="ветка 0 · контрагент / счёт", deposits_note="оператор создаёт в админке; сюда поступает USDT",
        pool="Пул", pool_sub="ветка 1 · только TRX", pool_note="оператор пополняет TRX: активации и Energy",
        main="Основной кошелёк", main_sub="ветка 2 · весь баланс USDT", main_note="сюда приходят сборы, отсюда уходят выплаты",
        hops="Одноразовые адреса", hops_sub="ветка 3 · один на выплату", hops_note="один адрес для двух этапов выплаты",
        derive="вывод ключа", you="оператор", deposits_lbl="контрагент", trx_in="TRX", usdt_in="USDT",
        d2="Приём USDT: от контрагента до основного кошелька",
        counterparty="Контрагент", deposit_addr="Адрес поступлений", watcher="Сканер блоков", watcher_sub="solid‑блок ≈ 1 мин", deposit="Депозит записан", deposit_sub="confirmed",
        threshold="≥ 20 USDT или старше 72 ч", sweep="Сбор", sweep_sub="sweeping · Energy · подпись", swept="swept", dust="Ниже минимума: rejected (dust)",
        main2="Основной кошелёк", pool2="Пул (TRX)", pool2_note="активация адреса при необходимости", energy="Energy", energy_note="стейк пула; itrx.io — опционально",
        signer="Signer", signer_note="подписывает только перевод на основной", usdt="USDT", full="вся сумма",
        d3="Выплата: два шага через одноразовый адрес",
        request="Оператор", request_sub="заявка в админке", main3="Основной кошелёк", hop="Одноразовый адрес", hop_sub="создаётся для этой выплаты",
        recipient="Получатель", step1="шаг 1 · вся сумма", step2="шаг 2 · вся сумма", pool3="Пул (TRX)", pool3_note="TRX на активацию адреса", energy3="Energy", energy3_note="стейк; аренда опциональна",
        signer3="Signer", signer3_note="основной → свой одноразовый → получатель; проверка политики", sees="отправитель второго перевода; путь виден on-chain",
        d4="Где что хранится и кто что может",
        sg="Signer (изолирован)", sg1="seed‑фраза и все ключи", sg2="подписывает только 4 вида операций:", sg3="сбор → основной · основной → одноразовый", sg4="адрес → получатель · пул: стейк, Energy, TRX",
        core="Core (сервис)", core1="watcher, очереди, admin API", core2="знает только публичный ключ (xpub)", core3="ключей нет",
        db="PostgreSQL", db1="адреса, депозиты, сборы, выплаты", db2="настройки, аудит", db3="ключей нет",
        tron="Сеть TRON", itrx="itrx.io (опция)", sign="подписать (token)", read="блоки, балансы", bcast="отправка транзакций", rent="заказ Energy", store="читает/пишет",
    ),
    "en": dict(
        d1="Wallets: everything derives from one seed phrase", phrase="12 or 24 words", phrase_sub="stored only in the signer, encrypted",
        deposits="Deposit addresses", deposits_sub="branch 0 · counterparty / invoice", deposits_note="operator creates in admin UI; USDT arrives here",
        pool="Pool", pool_sub="branch 1 · TRX only", pool_note="operator adds TRX: activations and energy",
        main="Main wallet", main_sub="branch 2 · the whole USDT balance", main_note="sweeps land here, payouts leave from here",
        hops="One-time addresses", hops_sub="branch 3 · one per payout", hops_note="one address for the two payout stages",
        derive="key derivation", you="operator", deposits_lbl="counterparty", trx_in="TRX", usdt_in="USDT",
        d2="Receiving USDT: from the counterparty to the main wallet",
        counterparty="Counterparty", deposit_addr="Deposit address", watcher="Block scanner", watcher_sub="solid block ≈ 1 min", deposit="Deposit recorded", deposit_sub="confirmed",
        threshold="≥ 20 USDT or older than 72 h", sweep="Sweep", sweep_sub="sweeping · energy · signature", swept="swept", dust="Below minimum: rejected (dust)",
        main2="Main wallet", pool2="Pool (TRX)", pool2_note="address activation when needed", energy="Energy", energy_note="pool stake; optional itrx.io rental",
        signer="Signer", signer_note="signs only transfers to the main wallet", usdt="USDT", full="full amount",
        d3="Payout: two hops through a one-time address",
        request="Operator", request_sub="request in admin UI", main3="Main wallet", hop="One-time address", hop_sub="created for this payout",
        recipient="Recipient", step1="hop 1 · full amount", step2="hop 2 · full amount", pool3="Pool (TRX)", pool3_note="TRX for address activation", energy3="Energy", energy3_note="pool stake; rental optional",
        signer3="Signer", signer3_note="main → its own hop → recipient; policy-checked", sees="sender of stage 2; route is visible on-chain",
        d4="Where things live and who can do what",
        sg="Signer (isolated)", sg1="seed phrase and all keys", sg2="signs only 4 kinds of operations:", sg3="sweep → main · main → one-time", sg4="hop → recipient · pool: stake, energy, TRX",
        core="Core (service)", core1="watcher, queues, admin API", core2="knows only the public key (xpub)", core3="no keys",
        db="PostgreSQL", db1="addresses, deposits, sweeps, payouts", db2="settings, audit", db3="no keys",
        tron="TRON network", itrx="itrx.io (optional)", sign="sign (token)", read="blocks, balances", bcast="broadcast transactions", rent="order energy", store="reads/writes",
    ),
}


def d1(t):
    s = Svg(1040, 440, t["d1"])
    s.box(30, 190, 250, 70, t["phrase"], t["phrase_sub"], color=SIGNER)
    rows = [(60, "deposits", USDT), (150, "pool", TRX), (240, "main", USDT), (330, "hops", USDT)]
    for y, key, color in rows:
        s.box(360, y, 250, 60, t[key], t[key + "_sub"], color=color)
        s.text(630, y + 36, t[key + "_note"], size=11)
        s.arrow(280, 225, 360, y + 30, color=LINE)
    s.text(320, 180, t["derive"], size=11, anchor="middle")
    # who funds what
    s.path_arrow("M485,55 L485,60", lx=485, ly=45, label=f"{t['deposits_lbl']} → {t['usdt_in']}", color=USDT)
    s.path_arrow("M485,145 L485,150", lx=485, ly=135, label=f"{t['you']} → {t['trx_in']}", color=TRX)
    return s.render()


def d2(t):
    s = Svg(1120, 400, t["d2"])
    y = 70
    s.box(30, y, 110, 60, t["counterparty"], bold=False)
    s.box(190, y, 170, 60, t["deposit_addr"], t["usdt"], color=USDT)
    s.box(410, y, 160, 60, t["watcher"], t["watcher_sub"])
    s.box(620, y, 170, 60, t["deposit"], t["deposit_sub"])
    s.arrow(140, y + 30, 190, y + 30, t["usdt"], color=USDT)
    s.arrow(360, y + 30, 410, y + 30)
    s.arrow(570, y + 30, 620, y + 30)
    s.text(850, 110, t["dust"], size=11)
    # threshold → sweep → main
    s.path_arrow(f"M705,{y + 60} L705,{y + 150}", label=t["threshold"], lx=705, ly=y + 110)
    s.box(600, y + 150, 210, 70, t["sweep"], t["sweep_sub"], color=USDT)
    s.box(880, y + 150, 200, 70, t["main2"], t["swept"], color=USDT)
    s.arrow(810, y + 185, 880, y + 185, t["full"], color=USDT)
    # inputs to sweep
    s.box(30, y + 150, 250, 60, t["pool2"], t["pool2_note"], color=TRX)
    s.box(30, y + 240, 250, 60, t["energy"], t["energy_note"], color=TRX)
    s.box(330, y + 240, 240, 60, t["signer"], t["signer_note"], color=SIGNER)
    s.arrow(280, y + 180, 600, y + 180, color=TRX)
    s.path_arrow(f"M280,{y + 270} L310,{y + 270} L310,{y + 195} L600,{y + 195}", color=TRX)
    s.path_arrow(f"M570,{y + 270} L640,{y + 220}", color=SIGNER, dashed=True)
    return s.render()


def d3(t):
    s = Svg(1120, 440, t["d3"])
    y = 150
    s.box(30, y, 150, 70, t["request"], t["request_sub"], bold=False)
    s.box(240, y, 200, 70, t["main3"], t["usdt"], color=USDT)
    s.box(560, y, 220, 70, t["hop"], t["hop_sub"], color=USDT)
    s.box(880, y, 170, 70, t["recipient"], bold=False)
    s.arrow(180, y + 35, 240, y + 35)
    s.arrow(440, y + 35, 560, y + 35, t["step1"], color=USDT)
    s.arrow(780, y + 35, 880, y + 35, t["step2"], color=USDT)
    s.text(670, y + 95, t["sees"], size=11, anchor="middle", color=USDT)
    # signer above the chain: it signs both hops
    s.box(240, 55, 540, 50, t["signer3"], t["signer3_note"], color=SIGNER)
    s.path_arrow(f"M500,105 L500,{y + 28}", color=SIGNER, dashed=True)
    s.path_arrow(f"M700,105 L830,{y + 28}", color=SIGNER, dashed=True)
    # energy for both hops, activation for the hop address
    s.box(330, y + 150, 250, 60, t["energy3"], t["energy3_note"], color=TRX)
    s.box(640, y + 150, 250, 60, t["pool3"], t["pool3_note"], color=TRX)
    s.path_arrow(f"M400,{y + 150} L340,{y + 72}", color=TRX)
    s.path_arrow(f"M520,{y + 150} L640,{y + 72}", color=TRX)
    s.path_arrow(f"M740,{y + 150} L700,{y + 72}", color=TRX)
    s.text(560, 410, "planned → energy_pending → ready → signing → broadcast → confirmed/failed", size=12, anchor="middle")
    return s.render()


def d4(t):
    s = Svg(1060, 420, t["d4"])
    s.group_frame(30, 60, 400, 190, t["sg"], color=SIGNER)
    for i, k in enumerate(["sg1", "sg2", "sg3", "sg4"]):
        s.text(46, 100 + i * 24, t[k], size=12, color=INK if i == 0 else MUTED)
    s.group_frame(500, 60, 270, 190, t["core"], color=INK)
    for i, k in enumerate(["core1", "core2", "core3"]):
        s.text(516, 100 + i * 24, t[k], size=12, color=INK if i == 0 else MUTED)
    s.group_frame(820, 60, 220, 190, t["db"], color=INK)
    for i, k in enumerate(["db1", "db2", "db3"]):
        s.text(836, 100 + i * 24, t[k], size=12, color=INK if i == 0 else MUTED)
    s.arrow(500, 210, 430, 210, t["sign"], color=SIGNER)
    s.arrow(770, 210, 820, 210, t["store"])
    s.box(500, 330, 130, 50, t["tron"], bold=False)
    s.box(690, 330, 150, 50, t["itrx"], bold=False)
    s.path_arrow("M545,250 L545,330", label=t["read"], lx=500, ly=295)
    s.path_arrow("M600,250 L600,330", label=t["bcast"], lx=660, ly=295)
    s.path_arrow("M700,250 L740,330", label=t["rent"], lx=790, ly=295)
    return s.render()


for lang, t in L.items():
    for name, fn in [("wallets", d1), ("deposit-flow", d2), ("payout-flow", d3), ("components", d4)]:
        (OUT / f"{name}.{lang}.svg").write_text(fn(t), encoding="utf-8")

# Short operator-facing workflows. Keep wording in step with README and the real UI.
GUIDE = {
    'prepare': {
        'ru': ('Подготовка к установке', [('Docker + Python', 'Установите на компьютер'), ('Папка проекта', 'Скачайте эту версию проекта'), ('Терминал', 'Откройте в папке с README')], 'Результат: компьютер готов к запуску установщика.'),
        'en': ('Prepare for installation', [('Docker + Python', 'Install on your computer'), ('Project folder', 'Download this project version'), ('Terminal', 'Open next to README')], 'Result: the computer is ready to run the installer.'),
    },
    'trongrid': {
        'ru': ('TronGrid: получить ключ для чтения сети', [('trongrid.io', 'Зарегистрируйтесь и войдите'), ('API Keys', 'Создайте отдельный ключ'), ('Установщик', 'Вставьте ключ по запросу')], 'TronGrid читает балансы и поступления; деньги он не хранит.'),
        'en': ('TronGrid: obtain a network API key', [('trongrid.io', 'Register and sign in'), ('API Keys', 'Create a separate key'), ('Installer', 'Paste the key when prompted')], 'TronGrid reads balances and deposits; it does not hold your funds.'),
    },
    'install': {
        'ru': ('Установить и открыть кошелёк', [('install.sh', 'Выберите mainnet'), ('Ключ TronGrid', 'Вставьте и дождитесь Ready'), ('Все службы в Docker', 'Запускаются автоматически'), ('localhost:8080', 'Откройте в браузере')], 'Ежедневный бэкап включается автоматически: 03:00, последние 7 архивов.'),
        'en': ('Install and open the wallet', [('install.sh', 'Select mainnet'), ('TronGrid key', 'Paste it and wait for Ready'), ('Full Docker stack', 'Starts automatically'), ('localhost:8080', 'Open in your browser')], 'Daily backups are enabled automatically: 03:00, latest 7 archives.'),
    },
    'setup': {
        'ru': ('Настроить вход и сохранить доступ к деньгам', [('Проверка mainnet', 'Продолжите настройку'), ('SETUP_TOKEN', 'Логин, пароль и аутентификатор'), ('Создать / импортировать', 'Откройте страницу «Кошелёк»'), ('Seed-фраза', 'Запишите и храните отдельно')], 'Одна фраза управляет основным кошельком, пулом и адресами поступлений.'),
        'en': ('Set up login and keep access to your funds', [('Check mainnet', 'Continue setup'), ('SETUP_TOKEN', 'Login, password, authenticator'), ('Create / import', 'Open the Wallet page'), ('Seed phrase', 'Record and store separately')], 'One phrase controls the main wallet, pool and receiving addresses.'),
    },
    'energy': {
        'ru': ('itrx.io: аренда Energy для переводов USDT', [('Аккаунт itrx.io', 'Регистрация и раздел API'), ('Key + Secret', 'Сохраните и проверьте'), ('Адрес пополнения', 'Настройте перевод из пула'), ('Заказ Energy', 'Нужные TRX идут из пула')], 'При нехватке баланса платёжка пополняет itrx.io из пула и повторяет заказ.'),
        'en': ('itrx.io: rent Energy for USDT transfers', [('itrx.io account', 'Register and open API'), ('Key + Secret', 'Save and test connection'), ('Deposit address', 'Configure pool top-up'), ('Energy order', 'Required TRX from the pool')], 'If the balance is insufficient, the system tops up itrx.io from the pool and retries.'),
    },
    'pool-funding': {
        'ru': ('Второй кошелёк: куда отправлять TRX', [('Страница «Кошелёк»', 'Найдите «Пул (TRX для комиссий)»'), ('Адрес пула', 'Скопируйте именно этот адрес'), ('Отправьте TRX', 'С биржи или другого кошелька'), ('Баланс пула', 'Проверьте после подтверждения')], 'Пул оплачивает активации и сетевые расходы. USDT клиентам дают получать на отдельные адреса.'),
        'en': ('The second wallet: where to send TRX', [('Wallet page', 'Find Pool (TRX for fees)'), ('Pool address', 'Copy this specific address'), ('Send TRX', 'From an exchange or wallet'), ('Pool balance', 'Check after confirmation')], 'The pool pays for activations and network expenses. Clients use separate USDT receiving addresses.'),
    },
    'receive-address': {
        'ru': ('Создать адрес для получения USDT', [('Создать адрес', 'На странице «Кошелёк»'), ('Имя invoice-001', 'Заполните и нажмите «Создать»'), ('Адрес + сеть TRON', 'Передайте отправителю USDT'), ('Раздел «Депозиты»', 'Дождитесь поступления')], 'Повторяйте для каждого клиента или счёта. Все адреса доступны в разделе «Адреса».'),
        'en': ('Create an address to receive USDT', [('Create address', 'On the Wallet page'), ('Name invoice-001', 'Enter it and click Create'), ('Address + TRON network', 'Share with the USDT sender'), ('Deposits', 'Wait for the incoming transfer')], 'Repeat for each client or invoice. All receiving addresses are listed under Addresses.'),
    },
    'backup': {
        'ru': ('Автоматический бэкап: один архив каждый день', [('Cron: 03:00', 'Компьютер и Docker включены'), ('Согласованная копия', 'Службы ненадолго остановятся'), ('backups/*.tar.gz', 'Ключи, база, очереди, настройки'), ('Последние 7 архивов', 'Скопируйте вне компьютера')], 'Старые архивы удаляются только после успешного нового бэкапа.'),
        'en': ('Automatic backup: one archive every day', [('Cron: 03:00', 'Computer and Docker running'), ('Consistent snapshot', 'Services stop briefly'), ('backups/*.tar.gz', 'Keys, database, queues, settings'), ('Latest 7 archives', 'Copy off the computer')], 'Old archives are removed only after a successful new backup.'),
    },
    'restore': {
        'ru': ('Восстановление из полного архива', [('Та же версия проекта', 'Docker + Python + архив'), ('restore.sh + архив', 'Введите RESTORE'), ('Данные восстановлены', 'Службы запустятся сами'), ('Прежний вход', 'Тот же пароль и аутентификатор')], 'На существующей установке сначала создаётся отдельный полный бэкап для отката.'),
        'en': ('Restore from a complete archive', [('Same project version', 'Docker + Python + archive'), ('restore.sh + archive', 'Type RESTORE'), ('Data restored', 'Services start automatically'), ('Original login', 'Same password and authenticator')], 'An existing installation first gets its own complete rollback backup.'),
    },
}


def guide_diagram(title, items, note):
    s = Svg(1120, 224, title)
    gap, left = 32, 24
    width = (1120 - left * 2 - gap * (len(items) - 1)) / len(items)
    for i, (heading, caption) in enumerate(items):
        x = left + i * (width + gap)
        s.parts.append(f"<rect x='{x}' y='64' width='{width}' height='108' rx='12' fill='#f5faf9' stroke='{USDT}' stroke-width='1.5'/>")
        s.parts.append(f"<circle cx='{x+20}' cy='84' r='11' fill='{USDT}'/>")
        s.text(x+20, 88, i+1, size=12, color='#ffffff', anchor='middle', weight='700')
        s.text(x+width/2, 116, heading, size=16, color=INK, anchor='middle', weight='600')
        s.text(x+width/2, 143, caption, size=12, anchor='middle')
        if i < len(items)-1:
            s.arrow(x+width+3, 120, x+width+gap-3, 120, color=USDT)
    s.text(24, 205, note, size=13)
    return s.render()


for name, translations in GUIDE.items():
    for lang, (title, items, note) in translations.items():
        (OUT / f'{name}.{lang}.svg').write_text(guide_diagram(title, items, note), encoding='utf-8')

for lang in ['ru', 'en']:
    ru = lang == 'ru'
    title = 'Три вида адресов: что куда отправлять' if ru else 'Three types of addresses: what goes where'
    s = Svg(1120, 230, title)
    items = [
        ('Адреса поступлений', 'Отправитель переводит сюда USDT', 'Вы создаёте адрес на клиента / счёт', USDT),
        ('Основной кошелёк', 'Здесь собираются USDT', 'Отсюда сервис отправляет выплаты', USDT),
        ('Пул — второй кошелёк', 'Вы пополняете его TRX', 'Активации и сетевые расходы', TRX),
    ] if ru else [
        ('Receiving addresses', 'Senders transfer USDT here', 'Create one per client / invoice', USDT),
        ('Main wallet', 'Collected USDT is held here', 'The service sends payouts from here', USDT),
        ('Pool — the second wallet', 'You fund this wallet with TRX', 'Activations and network expenses', TRX),
    ]
    for i, (heading, sub, detail, color) in enumerate(items):
        x = 24 + i * 368
        s.parts.append(f"<rect x='{x}' y='65' width='336' height='115' rx='12' fill='#ffffff' stroke='{color}' stroke-width='2'/>")
        s.text(x+168, 97, heading, size=18, color=color, anchor='middle', weight='700')
        s.text(x+168, 127, sub, size=15, color=INK, anchor='middle')
        s.text(x+168, 155, detail, size=13, anchor='middle')
    s.text(24, 212, 'itrx.io: при настроенном автопополнении TRX для аренды Energy поступают из пула.' if ru else 'itrx.io: configured automatic top-up sends rental TRX from the pool.', size=14)
    (OUT / f'wallet-guide.{lang}.svg').write_text(s.render(), encoding='utf-8')

print("28 diagrams written (RU + EN)")
