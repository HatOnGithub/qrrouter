<?php
/** Pure read-only printed-label batch aggregation. */
if (!defined('DOL_DOCUMENT_ROOT')) {
    exit();
}
function qrr_unassigned_batches($state) {
    return qrr_command('query-batches', []);
}
