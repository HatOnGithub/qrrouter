<?php
/** Administrator-only connection settings, stored through Dolibarr's native configuration API. */
$res = 0;
if (is_file(__DIR__ . '/../../../main.inc.php')) {
    $res = include __DIR__ . '/../../../main.inc.php';
}
if (!$res) {
    http_response_code(503);
    exit('Dolibarr bootstrap unavailable');
}
if (empty($user->admin)) {
    accessforbidden();
}
require_once DOL_DOCUMENT_ROOT . '/core/lib/admin.lib.php';
require_once __DIR__ . '/../lib/qrrouter.lib.php';
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$url = (string) ($conf->global->QRR_SERVICE_URL ?? 'http://127.0.0.1:5087');
$hasKey = !empty($conf->global->QRR_SERVICE_API_KEY);
$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        qrr_check_post();
    } catch (RuntimeException $exception) {
        accessforbidden($exception->getMessage());
    }
    $url = (string) GETPOST('service_url', 'alphanohtml');
    // Read the password without HTML filtering: it is never rendered or logged.
    $key = (string) GETPOST('service_api_key', 'none');
    if ($key === '') {
        $key = (string) ($conf->global->QRR_SERVICE_API_KEY ?? '');
    }
    try {
        $settings = qrr_validate_service_settings($url, $key);
        $previousUrl = $conf->global->QRR_SERVICE_URL ?? '';
        $previousKey = $conf->global->QRR_SERVICE_API_KEY ?? '';
        $db->begin();
        // Constants ending in _KEY receive Dolibarr's native secret encryption.
        if (
            dolibarr_set_const(
                $db,
                'QRR_SERVICE_URL',
                $settings['url'],
                'chaine',
                0,
                '',
                $conf->entity,
            ) <= 0 ||
            dolibarr_set_const(
                $db,
                'QRR_SERVICE_API_KEY',
                $settings['key'],
                'chaine',
                0,
                '',
                $conf->entity,
            ) <= 0
        ) {
            $db->rollback();
            $conf->global->QRR_SERVICE_URL = $previousUrl;
            $conf->global->QRR_SERVICE_API_KEY = $previousKey;
            throw new RuntimeException('Unable to save the connection settings.');
        }
        $db->commit();
        setEventMessages(qrr_t('Settings saved.'), null, 'mesgs');
        header('Location: ' . dol_buildpath('/qrrouter/admin/setup.php', 1));
        exit();
    } catch (InvalidArgumentException $exception) {
        http_response_code(400);
        $error = $exception->getMessage();
    } catch (RuntimeException $exception) {
        http_response_code(500);
        $error = $exception->getMessage();
    }
}

llxHeader('', qrr_t('QR Router setup'));
?>
<h1><?php print qrr_h(qrr_t('QR Router setup')); ?></h1>
<?php if ($error !== '') { ?>
    <div class="error" role="alert"><?php print qrr_h(qrr_t($error)); ?></div>
<?php } ?>
<form method="post" action="<?php print qrr_h(
    dol_buildpath('/qrrouter/admin/setup.php', 1),
); ?>" autocomplete="off">
    <?php print qrr_form_token(); ?>
    <div class="div-table-responsive">
        <table class="noborder centpercent">
            <tr class="liste_titre">
                <th colspan="2"><?php print qrr_h(qrr_t('Business service connection')); ?></th>
            </tr>
            <tr class="oddeven">
                <td><label for="service_url"><?php print qrr_h(
                    qrr_t('Service URL'),
                ); ?></label></td>
                <td>
                    <input class="flat minwidth300" type="url" id="service_url" name="service_url" value="<?php print qrr_h(
                        $url,
                    ); ?>" maxlength="2048" required>
                    <p class="opacitymedium"><?php print qrr_h(
                        qrr_t(
                            'Use http://127.0.0.1:5087 for PHP on the same host, or http://qrrouter-api:8080 for containers on a shared network.',
                        ),
                    ); ?></p>
                </td>
            </tr>
            <tr class="oddeven">
                <td><label for="service_api_key"><?php print qrr_h(
                    qrr_t('Service API key'),
                ); ?></label></td>
                <td>
                    <input class="flat minwidth300" type="password" id="service_api_key" name="service_api_key" value="" minlength="32" maxlength="512" autocomplete="new-password"<?php print $hasKey
                        ? ''
                        : ' required'; ?>>
                    <p class="opacitymedium"><?php print qrr_h(
                        qrr_t(
                            $hasKey
                                ? 'An API key is saved. Leave this field empty to keep it.'
                                : 'Enter the same API key configured on the business service.',
                        ),
                    ); ?></p>
                </td>
            </tr>
        </table>
    </div>
    <div class="center">
        <input class="button" type="submit" value="<?php print qrr_h(qrr_t('Save')); ?>">
    </div>
</form>
<?php llxFooter(); ?>
