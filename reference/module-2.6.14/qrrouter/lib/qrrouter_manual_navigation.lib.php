<?php
/** Context-safe return links from manual entry to the originating QR camera flow. */
if (!defined('DOL_DOCUMENT_ROOT')) exit;

/**
 * Build known module routes rather than accepting a user-supplied return URL.
 * The operation stays selected even when manual input goes through POST/review.
 */
function qrr_manual_camera_return($intent, $mode = '', $action = '', $from = '', $copy = '') {
    $registrationModes = array(
        'unique' => 'Tracked Individual registration',
        'generic' => 'Tracked Generic registration',
        'box' => 'Counted Container registration',
    );
    $workflowActions = array(
        'move' => 'Move items',
        'checkout' => 'Check out items',
        'checkin' => 'Check in items',
        'consume' => 'Consume items',
    );
    if ($intent === 'register' && isset($registrationModes[$mode])) {
        $args = array('mode' => $mode);
        if ($copy !== '' && qrr_code_valid($copy)) $args['copy'] = $copy;
        return array('url' => qrr_link('register.php', $args),
                     'label' => 'Back to registration camera',
                     'context' => $registrationModes[$mode]);
    }
    if ($intent === 'workflow' && isset($workflowActions[$action])) {
        return array('url' => qrr_link('workflow.php', array('action' => $action)),
                     'label' => 'Back to '.$workflowActions[$action].' camera',
                     'context' => $workflowActions[$action]);
    }
    if ($intent === 'boxdest' && qrr_code_valid($from)) {
        return array('url' => qrr_link('camera.php', array('mode' => 'boxdest', 'from' => $from)),
                     'label' => 'Back to destination camera',
                     'context' => 'Transfer from '.$from);
    }
    return array('url' => qrr_link('camera.php'),
                 'label' => 'Back to QR camera',
                 'context' => 'Inspect QR codes');
}
