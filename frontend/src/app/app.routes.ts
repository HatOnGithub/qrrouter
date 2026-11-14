import { Routes } from '@angular/router';

// Lazy features share the bootstrap session. Routes are navigation, not authorization guards;
// feature controls and the PHP gateway must still enforce each independent capability.
export const routes: Routes = [
  {
    path: 'history',
    loadComponent: () =>
      import('@features/history/history.component').then(m => m.HistoryComponent),
  },
  {
    path: 'bins',
    loadComponent: () => import('@features/bins/bins.component').then(m => m.BinsComponent),
  },
  { path: '', pathMatch: 'full', redirectTo: 'inventory' },
  {
    path: 'csv',
    loadComponent: () => import('@features/csv/csv.component').then(m => m.CsvComponent),
  },
  {
    path: 'inventory',
    loadComponent: () =>
      import('@features/inventory/inventory.component').then(m => m.InventoryComponent),
  },
  {
    path: 'loans',
    loadComponent: () =>
      import('@features/inventory/inventory.component').then(m => m.InventoryComponent),
  },
  {
    path: 'scan',
    loadComponent: () => import('@features/scan/scan.component').then(m => m.ScanComponent),
  },
  {
    path: 'items/:code',
    loadComponent: () => import('@features/item/item.component').then(m => m.ItemComponent),
  },
  {
    path: 'edit/:code',
    loadComponent: () => import('@features/editor/editor.component').then(m => m.EditorComponent),
  },
  {
    path: 'register/details',
    loadComponent: () => import('@features/editor/editor.component').then(m => m.EditorComponent),
  },
  {
    path: 'register',
    loadComponent: () =>
      import('@features/registration/registration.component').then(m => m.RegistrationComponent),
  },
  {
    path: 'create',
    loadComponent: () => import('@features/editor/editor.component').then(m => m.EditorComponent),
  },
  {
    path: 'workflow/:kind',
    loadComponent: () =>
      import('@features/workflow/workflow.component').then(m => m.WorkflowComponent),
  },
  {
    path: 'labels',
    loadComponent: () => import('@features/labels/labels.component').then(m => m.LabelsComponent),
  },
  {
    path: 'locations',
    loadComponent: () =>
      import('@features/locations/locations.component').then(m => m.LocationsComponent),
  },
  {
    path: 'picking',
    loadComponent: () =>
      import('@features/picking/picking.component').then(m => m.PickingComponent),
  },
  {
    path: 'people',
    loadComponent: () => import('@features/people/people.component').then(m => m.PeopleComponent),
  },
  { path: '**', redirectTo: 'inventory' },
];
