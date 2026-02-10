/**
 * Configurable selectors for UI tests (key elements visible).
 * Override via env or extend for different target sites.
 */
module.exports = {
  keyElementSelectors: [
    'body',
    'main',
    '[role="main"]',
    'header',
    '.header',
    'nav',
    '[role="navigation"]'
  ],
  /** At least this many key elements must be visible for the test to pass */
  minVisibleKeyElements: 1,

  /** Tabs that must exist and have content on each API section page */
  requiredTabs: ['Documentação', 'Especificação', 'Utilização'],

  /** URLs that are not valid endpoints; tests that land here will fail (endpoint removed from tests). */
  excludedEndpoints: [
    'https://services.telecom.pt/camara-auth-sandbox',
    'https://services.telecom.pt/camara-auth-sandbox/'
  ],

  /**
   * API sections to test (no login). Each section is opened and validated for required tabs.
   * linkText: text to find when clicking into the section (e.g. card title or link).
   * envButton: 'Sandbox' or 'Produção' – which environment link to click if both exist.
   */
  apiSections: [
    { name: 'Device Location - Location Verification', linkText: 'Location Verification', envButton: 'Sandbox' },
    { name: 'Device Location - Location Retrieval', linkText: 'Location Retrieval', envButton: 'Sandbox' },
    { name: 'SIM Swap', linkText: 'SIM Swap', envButton: 'Sandbox' },
    { name: 'Quality on Demand', linkText: 'Quality on Demand', envButton: 'Sandbox' },
    { name: 'Quality on Demand - QoS Profiles', linkText: 'QoS Profiles', envButton: 'Sandbox' },
    { name: 'Device Identifier', linkText: 'Device Identifier', envButton: 'Sandbox' }
  ],

  /**
   * Filter panel (Filtro) – labels that must be present when the panel is visible.
   */
  filterPanel: {
    labels: ['Filtro', 'filtros aplicados', 'Limpar tudo', 'Categoria', 'Limpar', 'Mostrar menos']
  },

  /**
   * Filter validations: for each category selected, only the expected sections must appear.
   * expectedSections: each has title, descriptionContains (substring), envLabels (e.g. Sandbox, Produção).
   */
  filterValidations: [
    {
      categoryName: 'Device Location',
      expectedSections: [
        { title: 'Location Verification', descriptionContains: 'Verificar a localização geográfica de um dispositivo', envLabels: ['Sandbox', 'Produção'] },
        { title: 'Location Retrieval', descriptionContains: 'Obter a localização geográfica atual de um dispositivo', envLabels: ['Sandbox', 'Produção'] }
      ]
    }
  ]
};
