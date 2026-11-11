with open(r'c:\Users\HP\Documents\ia - pruebas\Vanessa\Boda\version_celular_boda\app.js', 'r', encoding='utf-8') as f:
    js = f.read()

funcs = [
    "cleanMesaName", "getTableOptionsHtml", "onGuestTableChange", "toggleGuestGroupTables",
    "editGuest", "deleteGuestAction", "openNewGuestModal", "saveGuestAction",
    "syncGuestsCountToConfig", "fetchGuestsFromGAS", "syncFromGASDirect", "connectAndSyncCloud",
    "triggerCloudSyncHeader", "adjustGuests", "syncBcvRates", "createAutoMinBudget",
    "applyComparablePreset", "renderTripleComparison", "openNewBudgetModal", "closeScenarioPreview",
    "exportSideBySidePdf", "closeModal", "openModal", "saveProviderAction", "saveItemAction",
    "recalculateModalBudgetCosts", "addModalInvoiceRow", "saveModalBudgetAction", "saveTaskAction",
    "sortTasks", "openNewProviderModal", "backToProvidersList", "openNewItemForCurrentProvider",
    "openNewTaskModal"
]

for fn in funcs:
    found = f"function {fn}" in js or f"{fn} =" in js or f"async function {fn}" in js
    print(f"{fn}: {'OK' if found else 'NOT FOUND'}")
