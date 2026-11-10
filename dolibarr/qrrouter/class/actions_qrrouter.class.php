<?php
/** Native cards remain independent of the QR service until a link is opened. */
class ActionsQrrouter {
    public $resprints = '';
    public $results = [];
    public $error = '';
    public $errors = [];
    private $db;

    public function __construct($db) {
        $this->db = $db;
    }

    public function addMoreActionsButtons($parameters, &$object, &$action, $hookmanager = null) {
        global $user;
        require_once __DIR__ . '/../lib/qrrouter.lib.php';
        require_once __DIR__ . '/../lib/qrrouter_related.lib.php';
        if (
            !qrr_inventory_right($user) ||
            empty($object->id) ||
            (int) $object->id < 1 ||
            $action === 'create'
        ) {
            return 0;
        }
        $contexts = explode(
            ':',
            (string) ($parameters['currentcontext'] ?? ($parameters['context'] ?? '')),
        );
        $kinds = [
            'productcard' => 'product',
            'warehousecard' => 'warehouse',
            'productlotcard' => 'lot',
            'usercard' => 'user',
            'ordercard' => 'salesorder',
            'mocard' => 'production',
            'expeditioncard' => 'shipment',
        ];
        foreach ($kinds as $context => $kind) {
            if (!in_array($context, $contexts, true)) {
                continue;
            }
            try {
                qrr_related_target($this->db, $user, $kind, (int) $object->id);
            } catch (Throwable $error) {
                // A QR extension must never prevent the native card from opening.
                return 0;
            }
            print '<a class="butAction" href="' .
                qrr_h(qrr_related_url($kind, (int) $object->id)) .
                '">' .
                qrr_h(qrr_t('QR entries')) .
                '</a>';
            break;
        }
        return 0;
    }
}
