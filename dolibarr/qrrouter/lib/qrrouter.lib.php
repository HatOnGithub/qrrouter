<?php
/** QR Router storage and integration helpers. No SQL writes. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}
require_once __DIR__ . '/qrrouter_service.lib.php';

function qrr_h($value) {
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Translation values are plain UTF-8; HTML escaping belongs at the rendering boundary. */
function qrr_plain_translation($value) {
    $text = (string) $value;
    for ($pass = 0; $pass < 4; $pass++) {
        $decoded = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        if ($decoded === $text) {
            break;
        }
        $text = $decoded;
    }
    return $text;
}

function qrr_translation_text($key, $fallback) {
    global $langs;
    $translated = $fallback;
    if (isset($langs) && is_object($langs)) {
        if (method_exists($langs, 'transnoentitiesnoconv')) {
            $translated = $langs->transnoentitiesnoconv($key);
        } elseif (method_exists($langs, 'trans')) {
            $translated = $langs->trans($key);
        }
    }
    if (!is_string($translated) || $translated === '' || $translated === $key) {
        $translated = $fallback;
    }
    return qrr_plain_translation($translated);
}

/** Translate module UI text through Dolibarr's current locale. The message key
 * is deterministic, and English is always the fallback. No stored item values
 * or backend machine identifiers are translated. */
function qrr_t($english) {
    global $langs;
    if (
        !isset($langs) ||
        !is_object($langs) ||
        (!method_exists($langs, 'trans') && !method_exists($langs, 'transnoentitiesnoconv'))
    ) {
        return qrr_plain_translation($english);
    }
    static $loaded = false;
    if (!$loaded && method_exists($langs, 'load')) {
        $langs->load('qrrouter@qrrouter');
        $loaded = true;
    }
    $key = 'QRRUI_' . substr(sha1((string) $english), 0, 12);
    return qrr_translation_text($key, $english);
}
/** Translate static HTML text and descriptive attributes, while leaving all
 * form values, links, scripts, styles and inventory data untouched. The source
 * templates remain English and the key dictionary provides localized text. */
/** JavaScript status messages use the same Dolibarr locale as PHP pages. */
function qrr_js_translations() {
    $phrases = [
        'Camera running',
        'Camera unavailable — use Restart camera or Enter codes manually.',
        'Camera unavailable: ',
        'Camera error: ',
        'QR does not contain a valid inventory identifier: ',
        'Invalid identifier: ',
        'Already scanned: ',
        'Maximum 200 codes per round',
        'Serialised Unique accepts one label at a time',
        'Added ',
        'Opening details for ',
        'Stop camera',
        'Restart camera',
        'Scan at least one QR code, or use manual entry.',
        'Scan exactly one QR label',
        ' Use Restart camera or Enter codes manually.',
        ' Enter codes manually if needed.',
        ' unique code',
        ' unique codes',
        ' scanned',
        ' of ',
        ' selected',
        'Select at least one item to continue.',
        'Searching…',
        'Selected: ',
        ' product(s). Scroll to select one.',
        'No matching products',
        'No product assigned',
        'Loading Binloc levels...',
        'Unable to load Binloc levels: ',
        'Selected product: ',
        'Choose a product from the scrollable results or clear your search.',
        'Select a transaction type to browse recent records.',
        ' result(s). Scroll and click a record to select it.',
        'No matching records. Try entering a different reference.',
        'Select an exact record from the scrollable results.',
        ' customer order(s). Scroll and click one to select it.',
        'No matching customer orders.',
        'Select a customer order from the scrollable results.',
        'Requesting camera permission…',
        'Camera ready. Loading JavaScript QR decoder…',
        'Camera active (native QR detection)',
        'Camera active (JavaScript QR detection). Point at a label.',
        'Camera active (JavaScript QR detection).',
        'Native QR detection failed; switching to JavaScript decoder…',
        'QR decoder error: ',
        'QR decoder loading timed out. Check the network or use a hardware scanner.',
        'QR decoder library is unavailable',
        'Cannot load QR decoder library. Check internet access or Content-Security-Policy.',
        'Camera API unavailable. Open this page over HTTPS and allow camera access.',
    ];
    $messages = [];
    foreach ($phrases as $english) {
        $messages[$english] = qrr_t($english);
    }
    return $messages;
}

function qrr_translate_markup($html) {
    global $langs;
    if (!isset($langs) || !is_object($langs) || !method_exists($langs, 'trans')) {
        return $html;
    }
    return preg_replace_callback(
        '~<script\b[^>]*>.*?</script\s*>|<style\b[^>]*>.*?</style\s*>|<!--.*?-->|<[^>]+>|[^<]+~is',
        function ($m) {
            $fragment = $m[0];
            if ($fragment === '') {
                return $fragment;
            }
            if ($fragment[0] === '<') {
                if (
                    preg_match('~^<(?:script|style)\b~i', $fragment) ||
                    strncmp($fragment, '<!--', 4) === 0
                ) {
                    return $fragment;
                }
                return preg_replace_callback(
                    '~\b(placeholder|aria-label|title|alt)=(\"([^\"]*)\"|\'([^\']*)\')~i',
                    function ($a) {
                        $quote = $a[2][0];
                        $raw = $quote === '"' ? $a[3] : $a[4];
                        $decoded = html_entity_decode($raw, ENT_QUOTES | ENT_HTML5, 'UTF-8');
                        $translated = qrr_t($decoded);
                        return $a[1] . '=' . $quote . qrr_h($translated) . $quote;
                    },
                    $fragment,
                );
            }
            if (trim($fragment) === '') {
                return $fragment;
            }
            if (!preg_match('/^(\s*)(.*?)(\s*)$/us', $fragment, $parts)) {
                return $fragment;
            }
            $decoded = html_entity_decode($parts[2], ENT_QUOTES | ENT_HTML5, 'UTF-8');
            $translated = qrr_t($decoded);
            return $translated === $decoded
                ? $fragment
                : $parts[1] . qrr_h($translated) . $parts[3];
        },
        $html,
    );
}

/** A saved item label is the primary identifier in the UI. Raw QR codes remain
 * the stable machine keys (form values, URLs, printing and integrations).
 */
function qrr_item_display_name($item) {
    $code = (string) ($item['code'] ?? '');
    $label = trim((string) ($item['label'] ?? ''));
    return $label !== '' && ($item['type'] ?? '') !== 'unassigned' ? $label : $code;
}
/** Render a labelled item consistently in lists and confirmation screens.
 * All content, including names, is escaped before it reaches HTML.
 */
function qrr_item_identity_html($item, $linked = true) {
    $code = (string) ($item['code'] ?? '');
    $name = qrr_item_display_name($item);
    $escaped = qrr_h($name);
    if ($linked && $code !== '') {
        $escaped =
            '<a class="qrr-item-name" href="' .
            qrr_h(qrr_base() . 'index.php#/items/' . rawurlencode($code)) .
            '">' .
            $escaped .
            '</a>';
    } else {
        $escaped = '<span class="qrr-item-name">' . $escaped . '</span>';
    }
    $qr =
        $name !== $code && $code !== ''
            ? '<small class="qrr-item-id">QR ' . qrr_h($code) . '</small>'
            : '';
    return '<span class="qrr-item-identity">' . $escaped . $qr . '</span>';
}

function qrr_read_right($user) {
    return !empty($user->admin) ||
        $user->hasRight('qrrouter', 'read') ||
        $user->hasRight('qrrouter', 'manage');
}
function qrr_write_right($user) {
    return !empty($user->admin) || $user->hasRight('qrrouter', 'manage');
}
function qrr_products_right($user) {
    return !empty($user->admin) ||
        $user->hasRight('produit', 'lire') ||
        $user->hasRight('service', 'lire');
}
function qrr_orders_right($user) {
    return !empty($user->admin) || $user->hasRight('commande', 'lire');
}
function qrr_token() {
    if (empty($_SESSION['qrr_token'])) {
        $_SESSION['qrr_token'] = bin2hex(random_bytes(24));
    }
    return $_SESSION['qrr_token'];
}
function qrr_check_post() {
    if (
        $_SERVER['REQUEST_METHOD'] !== 'POST' ||
        empty($_POST['qrr_token']) ||
        !hash_equals(qrr_token(), (string) $_POST['qrr_token'])
    ) {
        throw new RuntimeException('Invalid or expired form token. Refresh the page.');
    }
}
/** Six-character labels: five random symbols from a 31-character alphabet
 * plus a check symbol. Modulo 31 detects any single-symbol substitution and
 * any swap of two adjacent unequal symbols in the five-character payload.
 * Codes are inventory identifiers, not authentication secrets.
 */
function qrr_short_check_character($payload) {
    $alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    if (!is_string($payload) || strlen($payload) !== 5) {
        throw new InvalidArgumentException('Invalid short QR payload');
    }
    $state = 0;
    for ($i = 0; $i < 5; $i++) {
        $index = strpos($alphabet, $payload[$i]);
        if ($index === false) {
            throw new InvalidArgumentException('Invalid short QR character');
        }
        $state = ($state * 3 + $index + 1) % 31;
    }
    return $alphabet[$state];
}
function qrr_code_valid($code) {
    if (!is_string($code)) {
        return false;
    }
    if (strlen($code) === 6) {
        try {
            return hash_equals(qrr_short_check_character(substr($code, 0, 5)), $code[5]);
        } catch (InvalidArgumentException $e) {
            return false;
        }
    }
    // Existing random 10-character labels and prefixed legacy identifiers
    // remain valid forever; old stock and printed labels do not change.
    return (bool) preg_match(
        '/^(?:[A-HJ-NP-Z2-9]{10}|(?:ITM|GEN|BOX|QR)-[A-Z0-9_-]{6,48})$/D',
        $code,
    );
}

function qrr_types() {
    return [
        'unassigned' => qrr_t('Unassigned printable label'),
        'tracked' => qrr_t('Tracked Individual'),
        'generic' => qrr_t('Tracked Generic'),
        'box' => qrr_t('Counted Container'),
    ];
}
function qrr_base() {
    return dol_buildpath('/qrrouter/', 1);
}
function qrr_data_dir() {
    return rtrim(DOL_DATA_ROOT, '/\\') . '/qrrouter/entity-' . (int) $GLOBALS['conf']->entity;
}
function qrr_load_state() {
    global $db;
    $state = qrr_service('GET', '');
    foreach (qrr_native_observations($db, $state) as $code => $fields) {
        $state['items'][$code] = array_merge($state['items'][$code], $fields);
        $state['items'][$code]['bin_values'] = (array) $fields['bin_values'];
    }
    // Native intent snapshots are server-only. The browser only needs recovery status.
    if (!empty($state['pending_native'])) {
        $state['pending_native'] = array_intersect_key(
            $state['pending_native'],
            array_flip(['id', 'action', 'at']),
        );
    }
    return $state;
}

function qrr_product($db, $id) {
    if ((int) $id <= 0) {
        return null;
    }
    require_once DOL_DOCUMENT_ROOT . '/product/class/product.class.php';
    $p = new Product($db);
    if ($p->fetch((int) $id) <= 0) {
        return null;
    }
    return $p;
}
function qrr_warehouses($db) {
    $warehouses = [];
    $sql =
        'SELECT rowid, ref, lieu FROM ' .
        MAIN_DB_PREFIX .
        'entrepot WHERE entity IN (' .
        getEntity('stock') .
        ') ORDER BY ref';
    $res = $db->query($sql);
    if (!$res) {
        throw new RuntimeException('Unable to read Dolibarr warehouses: ' . $db->lasterror());
    }
    while ($r = $db->fetch_object($res)) {
        $warehouses[(int) $r->rowid] = ['ref' => (string) $r->ref, 'label' => (string) $r->lieu];
    }
    $db->free($res);
    return $warehouses;
}
function qrr_stock_totals($db, $productIds) {
    $out = [];
    $ids = array_values(array_unique(array_filter(array_map('intval', $productIds))));
    if (!$ids) {
        return $out;
    }
    $sql =
        'SELECT s.fk_product, s.fk_entrepot, s.reel FROM ' .
        MAIN_DB_PREFIX .
        'product_stock s INNER JOIN ' .
        MAIN_DB_PREFIX .
        'entrepot w ON w.rowid=s.fk_entrepot WHERE w.entity IN (' .
        getEntity('stock') .
        ') AND s.fk_product IN (' .
        implode(',', $ids) .
        ')';
    $res = $db->query($sql);
    if (!$res) {
        throw new RuntimeException('Unable to read Dolibarr stock');
    }
    while ($r = $db->fetch_object($res)) {
        $out[(int) $r->fk_product][(int) $r->fk_entrepot] = (float) $r->reel;
    }
    $db->free($res);
    return $out;
}
function qrr_qty($entry) {
    return $entry['type'] === 'unassigned' ? 0 : ($entry['type'] === 'box' ? $entry['qty'] : 1);
}
function qrr_bin_valid($bin) {
    return is_string($bin) && strlen($bin) <= 100 && !preg_match('/[<>\x00-\x1f]/', $bin);
}
function qrr_input_code($code) {
    return strtoupper(trim((string) $code));
}
function qrr_item_validate(
    $type,
    $label,
    $pid,
    $wid,
    $bin,
    $qty,
    $details,
    $serial,
    $db,
    $warehouses,
    $user
) {
    qrr_command(
        'validate',
        qrr_service_fields(
            $type,
            $label,
            $pid,
            $wid,
            ['bin' => $bin, 'bin_key' => '', 'bin_values' => []],
            $qty,
            $details,
            $serial,
        ),
    );
}
function qrr_bins_from_binloc($db, $warehouseId) {
    if (!$warehouseId) {
        return [];
    }
    $path = dol_buildpath('/binloc/class/binlocproductlocation.class.php', 0);
    if (!$path || !is_file($path)) {
        return [];
    }
    try {
        require_once $path;
        if (!class_exists('BinlocProductLocation')) {
            return [];
        }
        $loc = new BinlocProductLocation($db);
        $rows = $loc->fetchAllByWarehouse((int) $warehouseId);
        $options = [];
        foreach ($rows as $row) {
            $display = trim((string) ($row->location ?? ''));
            if ($display === '' || strlen($display) > 100) {
                continue;
            }
            $options[$display] = $display;
        }
        natcasesort($options);
        return array_values($options);
    } catch (Throwable $e) {
        dol_syslog(
            'QR Router cannot read Binloc location suggestions: ' . $e->getMessage(),
            LOG_WARNING,
        );
        return [];
    }
}
function qrr_scan_url($code) {
    return dol_buildpath('/qrrouter/index.php', 2) . '#/items/' . rawurlencode($code);
}
function qrr_personal_users($db) {
    // Dolibarr 21 uses getEntity('user') to handle multicompany visibility.
    $out = [];
    $sql =
        'SELECT u.rowid, u.login, u.firstname, u.lastname FROM ' .
        MAIN_DB_PREFIX .
        'user u WHERE u.statut=1 AND u.entity IN (' .
        getEntity('user') .
        ') ORDER BY u.lastname,u.firstname,u.login';
    $res = $db->query($sql);
    if (!$res) {
        throw new RuntimeException('Cannot read active Dolibarr users: ' . $db->lasterror());
    }
    while ($u = $db->fetch_object($res)) {
        $name = trim(trim((string) $u->firstname) . ' ' . trim((string) $u->lastname));
        $out[(int) $u->rowid] =
            ($name !== '' ? $name : (string) $u->login) . ' (' . $u->login . ')';
    }
    $db->free($res);
    return $out;
}
function qrr_warehouse_person_name($display) {
    return trim((string) preg_replace('/\s+\([^()]*\)$/', '', (string) $display));
}
/** Reuse an exact employee-named warehouse, or create one through native Entrepot::create().
 * Creation is only permitted to Dolibarr stock-warehouse creators; never direct SQL.
 */
function qrr_ensure_personal_warehouse($db, $actingUser, $personId, $people) {
    if (!isset($people[$personId])) {
        throw new RuntimeException('Choose an active Dolibarr user');
    }
    $state = qrr_load_state();
    $warehouses = qrr_warehouses($db);
    $mapped = (int) ($state['personal_warehouses'][$personId] ?? 0);
    if ($mapped && isset($warehouses[$mapped])) {
        return $mapped;
    }
    if ($mapped) {
        throw new RuntimeException(
            'Previously assigned personal warehouse is missing; an administrator must repair the mapping.',
        );
    }
    $name = qrr_warehouse_person_name($people[$personId]);
    if ($name === '' || strlen($name) > 120) {
        throw new RuntimeException('Invalid personal warehouse name');
    }
    $existing = 0;
    foreach ($warehouses as $wid => $w) {
        if (strcasecmp(trim((string) $w['ref']), $name) === 0) {
            if ($existing) {
                throw new RuntimeException(
                    'Multiple warehouses match the employee name. Configure the mapping manually.',
                );
            }
            $existing = (int) $wid;
        }
    }
    if (!$existing) {
        if (empty($actingUser->admin) && !$actingUser->hasRight('stock', 'creer')) {
            throw new RuntimeException(
                'Personal warehouse does not exist. Dolibarr Stock > Create warehouse permission is required for automatic creation.',
            );
        }
        require_once DOL_DOCUMENT_ROOT . '/product/stock/class/entrepot.class.php';
        $warehouse = new Entrepot($db);
        $warehouse->ref = $name;
        $warehouse->label = $name;
        $warehouse->lieu = $name;
        $warehouse->description =
            'Personal warehouse for QR Product Router (employee ' . (int) $personId . ')';
        $warehouse->statut = defined('Entrepot::STATUS_OPEN_ALL') ? Entrepot::STATUS_OPEN_ALL : 1;
        $existing = (int) $warehouse->create($actingUser);
        if ($existing <= 0) {
            throw new RuntimeException(
                'Could not create personal warehouse: ' .
                    ($warehouse->error ?: implode('; ', (array) $warehouse->errors)),
            );
        }
    }
    // Never share one personal warehouse across multiple people.
    qrr_command('resolve-mapping', [
        'user_id' => $personId,
        'warehouse_id' => $existing,
        'users' => (object) $people,
        'warehouses' => (object) qrr_warehouses($db),
        'resolve' => true,
    ]);
    return $existing;
}
function qrr_loan_data($item) {
    return is_array($item['checkout'] ?? null) ? $item['checkout'] : null;
}
function qrr_handoff_data($item) {
    return is_array($item['pending_handoff'] ?? null) ? $item['pending_handoff'] : null;
}
function qrr_native_transfer_url($pid) {
    return qrr_url_stock($pid) . '&action=transfer&token=' . rawurlencode(newToken());
}
function qrr_stock_qty($db, $pid, $wid) {
    $data = qrr_stock_totals($db, [$pid]);
    return (float) ($data[(int) $pid][(int) $wid] ?? 0);
}
function qrr_item_units($item) {
    if ($item['type'] === 'unassigned') {
        throw new RuntimeException('Assign this QR code to a product before checkout');
    }
    if (qrr_item_status($item) === 'consumed' || !empty($item['pending_operation'])) {
        throw new RuntimeException('Item consumed or operation pending');
    }
    if ($item['type'] === 'box') {
        if (!isset($item['qty']) || !is_int($item['qty']) || $item['qty'] < 1) {
            throw new RuntimeException('Count this box before checking it out');
        }
        return $item['qty'];
    }
    return 1;
}
function qrr_css() {
    return '<style>.qrr-item-identity{display:inline-flex;flex-direction:column;align-items:flex-start;max-width:100%;min-width:0;gap:3px}.qrr-item-name{font-size:14px;font-weight:700;line-height:1.35;overflow-wrap:anywhere}.qrr-item-id{display:block;color:#637486;font-size:11px;line-height:1.3;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:400;overflow-wrap:anywhere}.qrr-item-code-muted{display:block;color:#637486;font-size:12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.qrr-item-heading{margin:0 0 4px;overflow-wrap:anywhere}.qrr{max-width:1120px;margin:auto}.qrr-panel{padding:18px;border:1px solid #d5dbe2;border-radius:10px;margin:14px 0;background:var(--colorbackground,#fff)}.qrr-flex{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.qrr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.qrr-input{box-sizing:border-box;width:100%;padding:11px;font-size:16px;border:1px solid #9da7b1;border-radius:6px}.qrr-btn{padding:11px 15px;display:inline-block;background:#174a7a;color:#fff!important;text-decoration:none;border:0;border-radius:7px;cursor:pointer;font-size:15px}.qrr-btn.alt{background:#f3f5f7;color:#163755!important;border:1px solid #9da7b1}.qrr-table{width:100%;border-collapse:collapse}.qrr-table th,.qrr-table td{text-align:left;padding:9px;border-bottom:1px solid #dce1e6;vertical-align:top}.qrr-small{color:#59636f;font-size:13px}.qrr-tag{font:600 14px monospace;word-break:break-word}.qrr-alert{border-left:4px solid #b35b06;padding:12px;background:#fff6e9}.qrr-ok{border-left:4px solid #35824f;padding:12px;background:#eff9f1}.qrr-code-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(146px,1fr));gap:10px;margin-top:15px}.qrr-code-tile{display:flex;gap:6px;align-items:center;padding:6px;border:1px solid #cbd5df;border-radius:8px;text-decoration:none;overflow:hidden}.qrr-code-tile img{object-fit:contain;background:#fff;flex-shrink:0}.qrr-code-tile .qrr-tag{font-size:11px}.qrr-scan-thumb{width:112px;height:112px;object-fit:cover;border:1px solid #cbd5df;border-radius:8px;background:#fff;padding:4px}.qrr-lookup-results{display:block;box-sizing:border-box;width:100%;max-height:260px;overflow-y:auto;overscroll-behavior:contain;border:1px solid #9da7b1;border-radius:6px;background:var(--colorbackground,#fff);margin-top:5px;scrollbar-width:auto;-webkit-overflow-scrolling:touch}.qrr-lookup-results[hidden]{display:none!important}.qrr-lookup-option{display:block;box-sizing:border-box;width:100%;padding:11px 12px;background:transparent;color:inherit;border:0;border-bottom:1px solid #dce1e6;text-align:left;white-space:normal;overflow-wrap:anywhere;cursor:pointer;font:inherit}.qrr-lookup-option:last-child{border-bottom:0}.qrr-lookup-option:hover,.qrr-lookup-option:focus-visible{background:#e7f0f8;color:#163755;outline:2px solid #174a7a;outline-offset:-2px}@media(max-width:650px){.qrr-table thead{display:none}.qrr-table tr{display:block;border-bottom:1px solid #ccd2da;padding:9px}.qrr-table td{display:block;border:0;padding:3px}}@media print{.qrr-noprint,header,nav,footer,#id-left,.vmenu{display:none!important}.qrr{max-width:none}.qrr-panel{border:0;padding:0}}</style>';
}

function qrr_page_header($title) {
    global $conf;
    // Request-local: keep Dolibarr's top menu and let QR Router provide navigation.
    $conf->dol_hide_leftmenu = 1;
    llxHeader('', qrr_t($title));
}
function qrr_layout_start($title) {
    qrr_page_header($title);
    ob_start();
    print qrr_css() .
        '<div class="qrr"><p class="qrr-noprint"><a href="' .
        qrr_h(qrr_base() . 'index.php') .
        '">QR Router</a></p><h2>' .
        qrr_h(qrr_t($title)) .
        '</h2>';
}
function qrr_layout_end() {
    print '</div>';
    $content = ob_get_clean();
    print qrr_translate_markup($content);
    llxFooter();
}
function qrr_products_index($db, $ids) {
    $out = [];
    if (!$ids) {
        return $out;
    }
    foreach (array_unique(array_filter(array_map('intval', $ids))) as $id) {
        $p = qrr_product($db, $id);
        if ($p) {
            $out[$id] = ['ref' => (string) $p->ref, 'label' => (string) $p->label];
        }
    }
    return $out;
}
function qrr_url_product($pid) {
    return dol_buildpath('/product/card.php', 1) . '?id=' . (int) $pid;
}
function qrr_url_stock($pid) {
    return dol_buildpath('/product/stock/product.php', 1) . '?id=' . (int) $pid;
}
require_once __DIR__ . '/qrrouter_batches.lib.php';
require_once __DIR__ . '/qrrouter_thumbnails.lib.php';
require_once __DIR__ . '/qrrouter_extra.lib.php';
require_once __DIR__ . '/qrrouter_binloc.lib.php';
require_once __DIR__ . '/qrrouter_native.lib.php';
require_once __DIR__ . '/qrrouter_checkout.lib.php';
require_once __DIR__ . '/qrrouter_workflows.lib.php';
function qrr_boot() {
    $res = 0;
    if (!$res && file_exists(__DIR__ . '/../../../main.inc.php')) {
        $res = include __DIR__ . '/../../../main.inc.php';
    }
    return $res;
}
function qrr_fields($item) {
    return [
        'type' => $item['type'],
        'label' => $item['label'],
        'product_id' => (int) $item['product_id'],
        'warehouse_id' => (int) $item['warehouse_id'],
        'bin' => $item['bin'],
        'qty' => $item['qty'],
        'serial' => $item['serial'],
        'details' => $item['details'],
    ];
}
function qrr_link($file, $pairs = []) {
    return qrr_base() . $file . (count($pairs) ? '?' . http_build_query($pairs) : '');
}
function qrr_app_link($route, $pairs = []) {
    return qrr_base() .
        'index.php#/' .
        $route .
        (count($pairs) ? '?' . http_build_query($pairs) : '');
}
function qrr_form_token() {
    return '<input type="hidden" name="token" value="' .
        qrr_h(newToken()) .
        '"><input type="hidden" name="qrr_token" value="' .
        qrr_h(qrr_token()) .
        '">';
}
function qrr_warehouse_select($warehouses, $selected, $name = 'warehouse_id') {
    $html =
        '<select class="qrr-input" name="' .
        qrr_h($name) .
        '"><option value="0">Unassigned</option>';
    foreach ($warehouses as $id => $w) {
        $html .=
            '<option value="' .
            (int) $id .
            '"' .
            ((int) $id === (int) $selected ? ' selected' : '') .
            '>' .
            qrr_h($w['ref'] . ' — ' . $w['label']) .
            '</option>';
    }
    return $html . '</select>';
}
