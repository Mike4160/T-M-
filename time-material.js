var tmState = { sheets: [], activeSheetId: null, useSupabase: false };
var supabaseClient = null;
var storageKey = "tm_sheets_v1";
function $(selector) { return document.querySelector(selector); }
function esc(value) { return String(value == null ? "" : value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function escapeHtml(value) { return esc(value).replaceAll("\n", "<br>"); }
function money(value) { return Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "USD" }); }
function numberValue(id) { return Number($(id).value || 0); }
var signatureIsEmpty = true;
function setupSignaturePad() {
  var canvas = $("#signaturePad");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var drawing = false;
  function scaleCanvas() {
    var rect = canvas.getBoundingClientRect();
    var ratio = window.devicePixelRatio || 1;
    var existing = signatureIsEmpty ? "" : canvas.toDataURL("image/png");
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#17211d";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    if (existing) {
      var image = new Image();
      image.onload = function() { ctx.drawImage(image, 0, 0, rect.width, rect.height); };
      image.src = existing;
    }
  }
  function point(event) {
    var rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function start(event) {
    event.preventDefault();
    drawing = true;
    signatureIsEmpty = false;
    var p = point(event);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function move(event) {
    if (!drawing) return;
    event.preventDefault();
    var p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function stop(event) {
    if (!drawing) return;
    event.preventDefault();
    drawing = false;
  }
  canvas.addEventListener("pointerdown", start);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  canvas.addEventListener("pointerleave", stop);
  window.addEventListener("resize", scaleCanvas);
  scaleCanvas();
}
function clearSignature() {
  var canvas = $("#signaturePad");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var rect = canvas.getBoundingClientRect();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, rect.width, rect.height);
  signatureIsEmpty = true;
}
function signatureData() {
  var canvas = $("#signaturePad");
  if (!canvas || signatureIsEmpty) return "";
  return canvas.toDataURL("image/png");
}
function configured() { return window.MATERIAL_APP_SUPABASE_URL && !window.MATERIAL_APP_SUPABASE_URL.includes("PASTE_") && window.MATERIAL_APP_SUPABASE_ANON_KEY && !window.MATERIAL_APP_SUPABASE_ANON_KEY.includes("PASTE_"); }
function supabaseHeaders(extra) {
  return Object.assign({
    apikey: window.MATERIAL_APP_SUPABASE_ANON_KEY,
    Authorization: "Bearer " + window.MATERIAL_APP_SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  }, extra || {});
}
async function supabaseRequest(path, options) {
  var response = await fetch(window.MATERIAL_APP_SUPABASE_URL + "/rest/v1/" + path, Object.assign({ headers: supabaseHeaders() }, options || {}));
  var text = await response.text();
  var data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data && data.message ? data.message : text || response.statusText);
  return data;
}
function getEmployees(sheet) {
  if (Array.isArray(sheet.employees)) return sheet.employees;
  if (typeof sheet.employees === "string" && sheet.employees.trim()) {
    try { var parsed = JSON.parse(sheet.employees); if (Array.isArray(parsed)) return parsed; } catch (error) {}
  }
  if (sheet.crew || sheet.labor_hours || sheet.labor_rate) return [{ name: sheet.crew || "", hours: Number(sheet.labor_hours || 0), rate: Number(sheet.labor_rate || 0) }];
  return [];
}
function employeeLaborTotal(sheet) { return getEmployees(sheet).reduce(function(total, employee) { return total + (Number(employee.hours || 0) * Number(employee.rate || 0)); }, 0); }
function employeeHoursTotal(sheet) { return getEmployees(sheet).reduce(function(total, employee) { return total + Number(employee.hours || 0); }, 0); }
function employeeNames(sheet) { return getEmployees(sheet).map(function(employee) { return employee.name; }).filter(Boolean).join(", "); }
function employeeEmailLines(sheet) {
  var employees = getEmployees(sheet);
  if (!employees.length) return ["N/A"];
  return employees.map(function(employee) {
    return "- " + (employee.name || "Employee") + ": " + (employee.hours || 0) + " hrs @ " + money(employee.rate || 0) + " = " + money(Number(employee.hours || 0) * Number(employee.rate || 0));
  });
}
function getMaterialItems(sheet) {
  if (Array.isArray(sheet.material_items)) return sheet.material_items;
  if (typeof sheet.material_items === "string" && sheet.material_items.trim()) {
    try { var parsed = JSON.parse(sheet.material_items); if (Array.isArray(parsed)) return parsed; } catch (error) {}
  }
  if (sheet.materials || sheet.material_cost) return [{ description: sheet.materials || "Material", amount: 1, unit_price: Number(sheet.material_cost || 0), cost: Number(sheet.material_cost || 0) }];
  return [];
}
function materialLineTotal(item) { return Number(item.cost != null ? item.cost : (Number(item.amount || 0) * Number(item.unit_price || 0))); }
function materialTotal(sheet) { return getMaterialItems(sheet).reduce(function(total, item) { return total + materialLineTotal(item); }, 0); }
function materialDescriptions(sheet) { return getMaterialItems(sheet).map(function(item) { return item.description; }).filter(Boolean).join("\n"); }
function materialEmailLines(sheet) {
  var items = getMaterialItems(sheet);
  if (!items.length) return ["None"];
  return items.map(function(item) {
    return "- " + (item.description || "Material") + ": " + (item.amount || 0) + " @ " + money(item.unit_price || 0) + " = " + money(materialLineTotal(item));
  });
}
function getEquipmentItems(sheet) {
  if (Array.isArray(sheet.equipment_items)) return sheet.equipment_items;
  if (typeof sheet.equipment_items === "string" && sheet.equipment_items.trim()) {
    try { var parsed = JSON.parse(sheet.equipment_items); if (Array.isArray(parsed)) return parsed; } catch (error) {}
  }
  if (sheet.other_cost) return [{ description: "Equipment / Other", cost: Number(sheet.other_cost || 0) }];
  return [];
}
function equipmentTotal(sheet) { return getEquipmentItems(sheet).reduce(function(total, item) { return total + Number(item.cost || 0); }, 0); }
function equipmentEmailLines(sheet) {
  var items = getEquipmentItems(sheet);
  if (!items.length) return ["None"];
  return items.map(function(item) { return "- " + (item.description || "Equipment / Other") + ": " + money(item.cost || 0); });
}
function sheetTotal(sheet) { return employeeLaborTotal(sheet) + materialTotal(sheet) + equipmentTotal(sheet); }
function emailFor(sheet) {
  var subject = "T&M Sheet" + (sheet.sheet_number ? " " + sheet.sheet_number : "") + " - " + (sheet.project || "Project");
  var body = [
    "Hello,",
    "",
    "Please see the T&M sheet below.",
    "",
    "Project: " + (sheet.project || "N/A"),
    "Job Number: " + (sheet.sheet_number || "N/A"),
    "Date: " + (sheet.work_date || "N/A"),
    "Requested By: " + (sheet.requested_by || "N/A"),
    "Location: " + (sheet.location || "N/A"),
    "",
    "Work Performed:",
    sheet.work_performed || "N/A",
    "",
    "Employees:",
    employeeEmailLines(sheet).join("\n"),
    "Labor Hours: " + employeeHoursTotal(sheet),
    "Labor Total: " + money(employeeLaborTotal(sheet)),
    "",
    "Materials Used:",
    materialEmailLines(sheet).join("\n"),
    "Material Total: " + money(materialTotal(sheet)),
    "",
    "Equipment / Other:",
    equipmentEmailLines(sheet).join("\n"),
    "Equipment / Other Total: " + money(equipmentTotal(sheet)),
    "Total: " + money(sheetTotal(sheet)),
    "",
    "Notes: " + (sheet.notes || "None"),
    "Signature: " + (sheet.signature_data ? "Signed on file" : "Not signed")
  ].join("\n");
  return { subject: subject, body: body, href: "mailto:" + encodeURIComponent(sheet.send_to || "") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body) };
}
function localLoad() { try { tmState.sheets = JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch (error) { tmState.sheets = []; } }
function localSave() { localStorage.setItem(storageKey, JSON.stringify(tmState.sheets)); }
async function loadData() {
  if (configured()) {
    try {
      var data = await supabaseRequest("time_material_sheets?select=*&order=created_at.desc");
      tmState.useSupabase = true;
      tmState.sheets = data || [];
      $("#setupWarning").hidden = true;
      render();
      return;
    } catch (error) {
      console.error("Supabase load failed", error);
      $("#setupWarning").textContent = "Supabase error: " + error.message + ". Sheets are saved in this browser until this is fixed.";
    }
  }
  tmState.useSupabase = false;
  $("#setupWarning").hidden = false;
  localLoad();
  render();
}
function employeeRows() { return Array.from(document.querySelectorAll(".employee-row")); }
function readEmployees() {
  return employeeRows().map(function(row) {
    return {
      name: row.querySelector("[data-employee-name]").value.trim(),
      hours: Number(row.querySelector("[data-employee-hours]").value || 0),
      rate: Number(row.querySelector("[data-employee-rate]").value || 0)
    };
  }).filter(function(employee) { return employee.name || employee.hours || employee.rate; });
}
function materialRows() { return Array.from(document.querySelectorAll(".material-row")); }
function readMaterialItems() {
  return materialRows().map(function(row) {
    var amount = Number(row.querySelector("[data-material-amount]").value || 0);
    var unitPrice = Number(row.querySelector("[data-material-unit-price]").value || 0);
    return {
      description: row.querySelector("[data-material-description]").value.trim(),
      amount: amount,
      unit_price: unitPrice,
      cost: amount * unitPrice
    };
  }).filter(function(item) { return item.description || item.amount || item.unit_price || item.cost; });
}
function updateMaterialRowTotal(row) {
  var amount = Number(row.querySelector("[data-material-amount]").value || 0);
  var unitPrice = Number(row.querySelector("[data-material-unit-price]").value || 0);
  row.querySelector("[data-material-total]").value = (amount * unitPrice).toFixed(2);
}
function addMaterialRow(item) {
  item = item || {};
  var row = document.createElement("div");
  row.className = "material-row";
  row.innerHTML = '<label>Material<input data-material-description placeholder="Wire, conduit, fittings, etc."></label><label>Amount Used<input data-material-amount type="number" min="0" step="0.01" placeholder="0.00"></label><label>Unit Price<input data-material-unit-price type="number" min="0" step="0.01" placeholder="0.00"></label><label>Total<input data-material-total type="number" readonly placeholder="0.00"></label><button class="btn icon-btn" data-remove-material type="button">x</button>';
  row.querySelector("[data-material-description]").value = item.description || "";
  row.querySelector("[data-material-amount]").value = item.amount || "";
  row.querySelector("[data-material-unit-price]").value = item.unit_price != null ? item.unit_price : (item.amount ? Number(item.cost || 0) / Number(item.amount || 1) : item.cost || "");
  updateMaterialRowTotal(row);
  $("#materialList").appendChild(row);
}
function ensureMaterialSection() {
  if ($("#materialList")) return;
  var oldMaterials = $("#materials");
  var oldMaterialCost = $("#materialCost");
  var section = document.createElement("section");
  section.className = "material-section";
  section.innerHTML = '<div class="mini-toolbar"><h3>Material Used</h3><button class="btn" id="addMaterial" type="button">Add Material</button></div><div class="material-list" id="materialList"></div>';
  var insertBefore = document.querySelector(".equipment-section") || (oldMaterialCost ? oldMaterialCost.closest("label") : null);
  if (insertBefore && insertBefore.parentNode) insertBefore.parentNode.insertBefore(section, insertBefore);
  else if (oldMaterials && oldMaterials.closest("label")) oldMaterials.closest("label").after(section);
  if (oldMaterials) {
    addMaterialRow({ description: oldMaterials.value || "", amount: oldMaterialCost && Number(oldMaterialCost.value || 0) ? 1 : "", unit_price: oldMaterialCost ? oldMaterialCost.value : "" });
    oldMaterials.closest("label").hidden = true;
  }
  if (oldMaterialCost) oldMaterialCost.closest("label").hidden = true;
  var addButton = $("#addMaterial");
  if (addButton && !addButton.dataset.bound) {
    addButton.dataset.bound = "true";
    addButton.addEventListener("click", function() { addMaterialRow(); });
  }
}
function resetMaterials() {
  ensureMaterialSection();
  $("#materialList").innerHTML = "";
  addMaterialRow();
}
function equipmentRows() { return Array.from(document.querySelectorAll(".equipment-row")); }
function readEquipmentItems() {
  return equipmentRows().map(function(row) {
    return {
      description: row.querySelector("[data-equipment-description]").value.trim(),
      cost: Number(row.querySelector("[data-equipment-cost]").value || 0)
    };
  }).filter(function(item) { return item.description || item.cost; });
}
function addEquipmentRow(item) {
  item = item || {};
  var row = document.createElement("div");
  row.className = "equipment-row";
  row.innerHTML = '<label>Description<input data-equipment-description placeholder="Lift, rental, permit, misc."></label><label>Cost<input data-equipment-cost type="number" min="0" step="0.01" placeholder="0.00"></label><button class="btn icon-btn" data-remove-equipment type="button">x</button>';
  row.querySelector("[data-equipment-description]").value = item.description || "";
  row.querySelector("[data-equipment-cost]").value = item.cost || "";
  $("#equipmentList").appendChild(row);
}
function resetEquipment() {
  $("#equipmentList").innerHTML = "";
  addEquipmentRow();
}
function addEmployeeRow(employee) {
  employee = employee || {};
  var row = document.createElement("div");
  row.className = "employee-row";
  row.innerHTML = '<label>Name<input data-employee-name placeholder="Employee name"></label><label>Hours<input data-employee-hours type="number" min="0" step="0.25" placeholder="0.00"></label><label>Rate<input data-employee-rate type="number" min="0" step="0.01" placeholder="0.00"></label><button class="btn icon-btn" data-remove-employee type="button">x</button>';
  row.querySelector("[data-employee-name]").value = employee.name || "";
  row.querySelector("[data-employee-hours]").value = employee.hours || "";
  row.querySelector("[data-employee-rate]").value = employee.rate || "";
  $("#employeeList").appendChild(row);
}
function resetEmployees() {
  $("#employeeList").innerHTML = "";
  addEmployeeRow();
}
function readForm() {
  var employees = readEmployees();
  var materialItems = readMaterialItems();
  var materialCost = materialItems.reduce(function(total, item) { return total + Number(item.cost || 0); }, 0);
  var equipmentItems = readEquipmentItems();
  var equipmentCost = equipmentItems.reduce(function(total, item) { return total + Number(item.cost || 0); }, 0);
  var totalHours = employees.reduce(function(total, employee) { return total + Number(employee.hours || 0); }, 0);
  var laborTotal = employees.reduce(function(total, employee) { return total + (Number(employee.hours || 0) * Number(employee.rate || 0)); }, 0);
  var crew = employees.map(function(employee) { return employee.name; }).filter(Boolean).join(", ");
  return {
    id: String(Date.now()),
    work_date: $("#workDate").value,
    sheet_number: $("#sheetNumber").value.trim(),
    project: $("#project").value.trim(),
    requested_by: $("#requestedBy").value.trim(),
    location: $("#location").value.trim(),
    work_performed: $("#workPerformed").value.trim(),
    crew: crew,
    employees: employees,
    labor_hours: totalHours,
    labor_rate: totalHours ? laborTotal / totalHours : 0,
    materials: materialItems.map(function(item) { return item.description; }).filter(Boolean).join("\n"),
    material_items: materialItems,
    material_cost: materialCost,
    equipment_items: equipmentItems,
    other_cost: equipmentCost,
    send_to: $("#sendTo").value.trim(),
    notes: $("#notes").value.trim(),
    signature_data: signatureData(),
    email_sent: false,
    created_at: new Date().toISOString()
  };
}
async function addSheet(event) {
  event.preventDefault();
  var sheet = readForm();
  var saved = sheet;
  if (tmState.useSupabase) {
    var payload = Object.assign({}, sheet);
    delete payload.id;
    var inserted = await supabaseRequest("time_material_sheets", { method: "POST", body: JSON.stringify(payload) });
    saved = Array.isArray(inserted) ? inserted[0] : inserted;
  } else {
    tmState.sheets.unshift(sheet);
    localSave();
  }
  $("#tmForm").reset();
  $("#project").value = "";
  $("#workDate").value = new Date().toISOString().slice(0, 10);
  resetEmployees();
  resetMaterials();
  resetEquipment();
  clearSignature();
  await loadData();
  showEmailPreview(saved);
}
async function markSent(id) {
  if (tmState.useSupabase) {
    await supabaseRequest("time_material_sheets?id=eq." + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify({ email_sent: true }) });
  } else {
    tmState.sheets = tmState.sheets.map(function(sheet) { return String(sheet.id) === String(id) ? Object.assign({}, sheet, { email_sent: true }) : sheet; });
    localSave();
  }
  await loadData();
}
async function deleteSheet(id) {
  if (tmState.useSupabase) {
    await supabaseRequest("time_material_sheets?id=eq." + encodeURIComponent(id), { method: "DELETE" });
  } else {
    tmState.sheets = tmState.sheets.filter(function(sheet) { return String(sheet.id) !== String(id); });
    localSave();
  }
  await loadData();
}
function showEmailPreview(sheet) {
  var email = emailFor(sheet);
  tmState.activeSheetId = sheet.id;
  $("#emailText").textContent = email.body;
  var existingImage = document.querySelector(".signed-preview");
  if (existingImage) existingImage.remove();
  if (sheet.signature_data) {
    var image = document.createElement("img");
    image.className = "signed-preview";
    image.alt = "Saved signature";
    image.src = sheet.signature_data;
    $("#emailText").after(image);
  }
  $("#emailLink").href = email.href;
  $("#emailPreview").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function render() {
  var search = $("#search").value.toLowerCase();
  var sheets = tmState.sheets.filter(function(sheet) { return [sheet.sheet_number, sheet.project, sheet.requested_by, sheet.location, sheet.work_performed, sheet.crew, employeeNames(sheet)].join(" ").toLowerCase().includes(search); });
  $("#totalCount").textContent = tmState.sheets.length;
  $("#readyCount").textContent = tmState.sheets.filter(function(sheet) { return !sheet.email_sent; }).length;
  $("#sentCount").textContent = tmState.sheets.filter(function(sheet) { return sheet.email_sent; }).length;
  $("#sheetRows").innerHTML = sheets.map(function(sheet) {
    var email = emailFor(sheet);
    var statusClass = sheet.email_sent ? "sent" : "ready";
    var statusText = sheet.email_sent ? "Sent" : "Draft Ready";
    return '<tr><td>' + esc(sheet.work_date) + '</td><td><strong>' + esc(sheet.sheet_number || "Job") + '</strong><br><span class="muted">' + esc(sheet.project || "") + '</span></td><td class="work-text">' + esc(sheet.work_performed) + '<br><span class="muted">' + esc(sheet.location || "") + '</span></td><td>' + esc(employeeHoursTotal(sheet)) + '<br><span class="muted">' + esc(employeeNames(sheet) || sheet.crew || '') + '</span></td><td>' + money(sheetTotal(sheet)) + '</td><td><span class="badge ' + statusClass + '">' + statusText + '</span></td><td><div class="row"><a class="btn primary" href="' + email.href + '">Open Draft</a><button class="btn" type="button" data-print-sheet="' + esc(sheet.id) + '">Print Sheet</button><button class="btn" type="button" data-download-sheet="' + esc(sheet.id) + '">Download Word</button><button class="btn" type="button" data-download-excel="' + esc(sheet.id) + '">Download Excel</button><button class="btn" type="button" data-preview="' + esc(sheet.id) + '">Preview</button><button class="btn" type="button" data-mark-sent="' + esc(sheet.id) + '">Mark Sent</button><button class="btn danger" type="button" data-delete="' + esc(sheet.id) + '">Delete</button></div></td></tr>';
  }).join("") || '<tr><td colspan="7">No T&M sheets logged yet.</td></tr>';
}


function xmlEscape(value) {
  return String(value == null ? '' : value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
function excelCell(value, type, style, formula) {
  type = type || (typeof value === 'number' ? 'Number' : 'String');
  var attrs = style ? ' ss:StyleID="' + style + '"' : '';
  if (formula) attrs += ' ss:Formula="' + xmlEscape(formula) + '"';
  return '<Cell' + attrs + '><Data ss:Type="' + type + '">' + xmlEscape(value == null ? '' : value) + '</Data></Cell>';
}
function excelEmpty(count) {
  var out = '';
  for (var i = 0; i < count; i++) out += '<Cell/>';
  return out;
}
function excelRow(cells) { return '<Row>' + cells.join('') + '</Row>'; }
function excelSheetXml(sheet) {
  var employees = getEmployees(sheet);
  var materials = getMaterialItems(sheet);
  var equipment = getEquipmentItems(sheet);
  var row = 1;
  function td(value, cls, extra) { return '<td class="' + (cls || '') + '" ' + (extra || '') + '>' + escapeHtml(value == null ? '' : value) + '</td>'; }
  function formula(expr, cls) { return '<td class="' + (cls || 'money') + '">=' + expr + '</td>'; }
  function spacerRow() { html += '<tr class="spacer"><td colspan="4"></td></tr>'; row++; }
  var html = '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,sans-serif}.sheet{width:100%}table{border-collapse:collapse;width:100%}td,th{border:1px solid #111;padding:7px;vertical-align:top}th{background:#e9eeec;text-align:left}.title{font-size:22px;font-weight:bold;border:0}.section{background:#111;color:#fff;font-weight:bold;text-transform:uppercase}.label{background:#f4f6f5;font-weight:bold}.money{mso-number-format:"$#,##0.00";text-align:right}.num{mso-number-format:"0.00";text-align:right}.total{background:#e9eeec;font-weight:bold}.grand{background:#dce4e1;font-weight:bold;font-size:14px}.wrap{white-space:normal}.signature{height:90px}.signature img{max-height:85px;max-width:280px}.spacer td{border:0;height:16px;background:#fff}' +
    '</style></head><body><table class="sheet">';
  html += '<tr><td class="title" colspan="4">TIME AND MATERIAL SHEET</td></tr>'; row++;
  html += '<tr>' + td('Project','label') + td(sheet.project || '') + td('Job Number','label') + td(sheet.sheet_number || '') + '</tr>'; row++;
  html += '<tr>' + td('Date','label') + td(sheet.work_date || '') + td('Requested By','label') + td(sheet.requested_by || '') + '</tr>'; row++;
  html += '<tr>' + td('Location','label') + td(sheet.location || '') + td('Signed','label') + td(sheet.signature_data ? 'Yes' : 'No') + '</tr>'; row++;
  spacerRow();
  html += '<tr><td class="section" colspan="4">Work Performed</td></tr>'; row++;
  html += '<tr><td class="wrap" colspan="4">' + escapeHtml(sheet.work_performed || '') + '</td></tr>'; row++;
  spacerRow();
  html += '<tr><td class="section" colspan="4">Employees</td></tr>'; row++;
  html += '<tr><th>Name</th><th>Hours</th><th>Rate</th><th>Total</th></tr>'; row++;
  var employeeStart = row;
  var employeeList = employees.length ? employees : [{ name: '', hours: 0, rate: 0 }];
  employeeList.forEach(function(employee) {
    html += '<tr>' + td(employee.name || '') + td(employee.hours || 0, 'num') + td(employee.rate || 0, 'money') + formula('B' + row + '*C' + row) + '</tr>';
    row++;
  });
  var employeeEnd = row - 1;
  var laborTotalRow = row;
  html += '<tr>' + td('Labor Total','total') + '<td class="total"></td><td class="total"></td>' + formula('SUM(D' + employeeStart + ':D' + employeeEnd + ')', 'money total') + '</tr>'; row++;
  spacerRow();
  html += '<tr><td class="section" colspan="4">Material Used</td></tr>'; row++;
  html += '<tr><th>Material</th><th>Amount Used</th><th>Unit Price</th><th>Total</th></tr>'; row++;
  var materialStart = row;
  var materialList = materials.length ? materials : [{ description: '', amount: 0, unit_price: 0 }];
  materialList.forEach(function(item) {
    html += '<tr>' + td(item.description || '') + td(item.amount || 0, 'num') + td(item.unit_price || 0, 'money') + formula('B' + row + '*C' + row) + '</tr>';
    row++;
  });
  var materialEnd = row - 1;
  var materialTotalRow = row;
  html += '<tr>' + td('Material Total','total') + '<td class="total"></td><td class="total"></td>' + formula('SUM(D' + materialStart + ':D' + materialEnd + ')', 'money total') + '</tr>'; row++;
  spacerRow();
  html += '<tr><td class="section" colspan="4">Equipment / Other</td></tr>'; row++;
  html += '<tr><th colspan="3">Description</th><th>Cost</th></tr>'; row++;
  var equipmentStart = row;
  var equipmentList = equipment.length ? equipment : [{ description: '', cost: 0 }];
  equipmentList.forEach(function(item) {
    html += '<tr><td colspan="3">' + escapeHtml(item.description || '') + '</td>' + td(item.cost || 0, 'money') + '</tr>';
    row++;
  });
  var equipmentEnd = row - 1;
  var equipmentTotalRow = row;
  html += '<tr>' + td('Equipment / Other Total','total') + '<td class="total"></td><td class="total"></td>' + formula('SUM(D' + equipmentStart + ':D' + equipmentEnd + ')', 'money total') + '</tr>'; row++;
  spacerRow();
  html += '<tr>' + td('Grand Total','grand') + '<td class="grand"></td><td class="grand"></td>' + formula('D' + laborTotalRow + '+D' + materialTotalRow + '+D' + equipmentTotalRow, 'money grand') + '</tr>'; row++;
  spacerRow();
  html += '<tr><td class="section" colspan="4">Notes</td></tr>'; row++;
  html += '<tr><td class="wrap" colspan="4">' + escapeHtml(sheet.notes || '') + '</td></tr>'; row++;
  html += '<tr><td class="label" colspan="2">Authorized Signature</td><td class="label" colspan="2">Printed Name / Date</td></tr>'; row++;
  html += '<tr><td class="signature" colspan="2">' + (sheet.signature_data ? '<img src="' + sheet.signature_data + '" alt="Signature">' : '') + '</td><td class="signature" colspan="2"></td></tr>'; row++;
  html += '</table></body></html>';
  return html;
}
function excelFileName(sheet) {
  var baseName = ['TM', sheet.sheet_number || 'sheet', sheet.work_date || ''].join('-').replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-');
  return baseName + '.xls';
}
function downloadExcelSheet(id) {
  var sheet = tmState.sheets.find(function(item) { return String(item.id) === String(id); });
  if (!sheet) return;
  var blob = new Blob([excelSheetXml(sheet)], { type: 'application/vnd.ms-excel' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = excelFileName(sheet);
  link.click();
  URL.revokeObjectURL(link.href);
}

function formattedSheetHtml(sheet) {
  var employees = getEmployees(sheet);
  var equipment = getEquipmentItems(sheet);
  var materials = getMaterialItems(sheet);
  var employeeRows = employees.map(function(employee) {
    var lineTotal = Number(employee.hours || 0) * Number(employee.rate || 0);
    return '<tr><td>' + escapeHtml(employee.name || '') + '</td><td class="num">' + escapeHtml(employee.hours || 0) + '</td><td class="num">' + money(employee.rate || 0) + '</td><td class="num">' + money(lineTotal) + '</td></tr>';
  }).join('') || '<tr><td colspan="4">No employees listed.</td></tr>';
  var materialRows = materials.map(function(item) {
    return '<tr><td>' + escapeHtml(item.description || '') + '</td><td class="num">' + escapeHtml(item.amount || 0) + '</td><td class="num">' + money(item.unit_price || 0) + '</td><td class="num">' + money(materialLineTotal(item)) + '</td></tr>';
  }).join('') || '<tr><td colspan="4">No materials listed.</td></tr>';
  var equipmentRows = equipment.map(function(item) {
    return '<tr><td>' + escapeHtml(item.description || '') + '</td><td class="num">' + money(item.cost || 0) + '</td></tr>';
  }).join('') || '<tr><td colspan="2">No equipment or other costs listed.</td></tr>';
  var signature = sheet.signature_data ? '<img class="signature-image" src="' + sheet.signature_data + '" alt="Signature">' : '<div class="signature-line"></div>';
  return '<!doctype html><html><head><meta charset="utf-8"><title>T&M Sheet</title><style>' +
    'body{margin:0;background:#e9eeec;font-family:Arial,sans-serif;color:#111} .sheet{width:8.5in;min-height:11in;margin:20px auto;background:#fff;padding:.35in;box-shadow:0 12px 36px rgba(0,0,0,.18)} .head{display:grid;grid-template-columns:110px 1fr;gap:18px;align-items:center;border-bottom:4px solid #111;padding-bottom:14px} .logo{max-width:105px;max-height:90px;object-fit:contain}.title h1{margin:0;font-size:30px;letter-spacing:.5px}.title p{margin:5px 0 0;font-weight:700;color:#1d6f5f;text-transform:uppercase}.meta{display:grid;grid-template-columns:repeat(4,1fr);border:2px solid #111;margin-top:16px}.box{border-right:1px solid #111;padding:8px;min-height:48px}.box:last-child{border-right:0}.label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;color:#555;margin-bottom:5px}.value{font-size:15px;font-weight:700}.section{margin-top:24px}.section h2{font-size:16px;margin:0;background:#111;color:#fff;padding:8px 10px;text-transform:uppercase;letter-spacing:.3px}.textblock{border:1px solid #111;border-top:0;min-height:78px;padding:10px;line-height:1.35}table{width:100%;border-collapse:collapse;border:1px solid #111;border-top:0}th,td{border:1px solid #111;padding:8px;text-align:left;vertical-align:top}th{background:#f1f3f2;text-transform:uppercase;font-size:12px}.num{text-align:right}.totals{margin-left:auto;margin-top:24px;width:330px;border:2px solid #111}.total-row{display:flex;justify-content:space-between;border-bottom:1px solid #111;padding:8px 10px}.total-row:last-child{border-bottom:0;background:#f1f3f2;font-size:18px;font-weight:800}.signature-wrap{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:28px}.signature-box{border:1px solid #111;min-height:105px;padding:8px}.signature-line{height:62px;border-bottom:2px solid #111;margin-top:14px}.signature-image{max-width:100%;max-height:75px;display:block}.footer{margin-top:16px;font-size:11px;color:#555}@media print{body{background:#fff}.sheet{margin:0;box-shadow:none;width:auto;min-height:auto}.no-print{display:none}}' +
    '</style></head><body><div class="sheet"><header class="head"><img class="logo" src="logo.png" alt="Logo"><div class="title"><p>Time and Material Sheet</p><h1>' + escapeHtml(sheet.project || 'T&M Work') + '</h1></div></header>' +
    '<section class="meta"><div class="box"><span class="label">Date</span><span class="value">' + escapeHtml(sheet.work_date || '') + '</span></div><div class="box"><span class="label">Job Number</span><span class="value">' + escapeHtml(sheet.sheet_number || '') + '</span></div><div class="box"><span class="label">Requested By</span><span class="value">' + escapeHtml(sheet.requested_by || '') + '</span></div><div class="box"><span class="label">Location</span><span class="value">' + escapeHtml(sheet.location || '') + '</span></div></section>' +
    '<section class="section"><h2>Work Performed</h2><div class="textblock">' + escapeHtml(sheet.work_performed || '') + '</div></section>' +
    '<section class="section"><h2>Employees</h2><table><thead><tr><th>Name</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Total</th></tr></thead><tbody>' + employeeRows + '</tbody></table></section>' +
    '<section class="section"><h2>Material Used</h2><table><thead><tr><th>Material</th><th class="num">Amount Used</th><th class="num">Unit Price</th><th class="num">Total</th></tr></thead><tbody>' + materialRows + '</tbody></table></section>' +
    '<section class="section"><h2>Equipment / Other</h2><table><thead><tr><th>Description</th><th class="num">Cost</th></tr></thead><tbody>' + equipmentRows + '</tbody></table></section>' +
    '<div class="totals"><div class="total-row"><span>Labor Total</span><strong>' + money(employeeLaborTotal(sheet)) + '</strong></div><div class="total-row"><span>Material Total</span><strong>' + money(materialTotal(sheet)) + '</strong></div><div class="total-row"><span>Equipment / Other</span><strong>' + money(equipmentTotal(sheet)) + '</strong></div><div class="total-row"><span>Total</span><strong>' + money(sheetTotal(sheet)) + '</strong></div></div>' +
    '<section class="section"><h2>Notes</h2><div class="textblock">' + escapeHtml(sheet.notes || '') + '</div></section>' +
    '<section class="signature-wrap"><div class="signature-box"><span class="label">Authorized Signature</span>' + signature + '</div><div class="signature-box"><span class="label">Printed Name / Date</span><div class="signature-line"></div></div></section>' +
    '<p class="footer">Generated from the T&M Sheet Sender.</p><p class="no-print"><button onclick="window.print()">Print / Save as PDF</button></p></div></body></html>';
}
function sheetFileName(sheet) {
  var baseName = ['TM', sheet.sheet_number || 'sheet', sheet.work_date || ''].join('-').replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-');
  return baseName + '.doc';
}
function downloadSheet(id) {
  var sheet = tmState.sheets.find(function(item) { return String(item.id) === String(id); });
  if (!sheet) return;
  var blob = new Blob([formattedSheetHtml(sheet)], { type: 'application/msword' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = sheetFileName(sheet);
  link.click();
  URL.revokeObjectURL(link.href);
}
function printSheet(id) {
  var sheet = tmState.sheets.find(function(item) { return String(item.id) === String(id); });
  if (!sheet) return;
  var win = window.open('', '_blank');
  if (!win) return alert('Please allow popups so the formatted T&M sheet can open.');
  win.document.open();
  win.document.write(formattedSheetHtml(sheet));
  win.document.close();
}

function exportCsv() {
  var headers = ["Date", "Job Number", "Project", "Requested By", "Location", "Work Performed", "Employees", "Labor Hours", "Labor Total", "Materials", "Material Cost", "Equipment / Other", "Equipment / Other Total", "Send To", "Notes", "Signed", "Email Sent"];
  var rows = tmState.sheets.map(function(sheet) { return [sheet.work_date, sheet.sheet_number, sheet.project, sheet.requested_by, sheet.location, sheet.work_performed, employeeEmailLines(sheet).join("; "), employeeHoursTotal(sheet), employeeLaborTotal(sheet), materialEmailLines(sheet).join("; "), materialTotal(sheet), equipmentEmailLines(sheet).join("; "), equipmentTotal(sheet), sheet.send_to, sheet.notes, sheet.signature_data ? "Yes" : "No", sheet.email_sent ? "Yes" : "No"]; });
  var csv = [headers].concat(rows).map(function(row) { return row.map(function(value) { return '"' + String(value == null ? "" : value).replaceAll('"', '""') + '"'; }).join(","); }).join("\n");
  var link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = "tm-sheets.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}
$("#workDate").value = new Date().toISOString().slice(0, 10);
ensureMaterialSection();
setupSignaturePad();
resetEmployees();
resetMaterials();
resetEquipment();
$("#addEmployee").addEventListener("click", function() { addEmployeeRow(); });
var addMaterialButton = $("#addMaterial");
if (addMaterialButton) { addMaterialButton.dataset.bound = "true"; addMaterialButton.addEventListener("click", function() { addMaterialRow(); }); }
$("#addEquipment").addEventListener("click", function() { addEquipmentRow(); });
$("#tmForm").addEventListener("submit", addSheet);
$("#search").addEventListener("input", render);
$("#exportCsv").addEventListener("click", exportCsv);
$("#clearSignature").addEventListener("click", clearSignature);
$("#markPreviewSent").addEventListener("click", function() { if (tmState.activeSheetId) markSent(tmState.activeSheetId); });
document.addEventListener("input", function(event) {
  var target = event.target;
  if (target.matches("[data-material-amount], [data-material-unit-price]")) updateMaterialRowTotal(target.closest(".material-row"));
});
document.addEventListener("click", function(event) {
  var target = event.target;
  if (target.matches("[data-remove-employee]")) {
    if (employeeRows().length > 1) target.closest(".employee-row").remove();
  }
  if (target.matches("[data-remove-material]")) {
    if (materialRows().length > 1) target.closest(".material-row").remove();
  }
  if (target.matches("[data-remove-equipment]")) {
    if (equipmentRows().length > 1) target.closest(".equipment-row").remove();
  }
  if (target.matches("[data-download-sheet]")) downloadSheet(target.dataset.downloadSheet);
  if (target.matches("[data-download-excel]")) downloadExcelSheet(target.dataset.downloadExcel);
  if (target.matches("[data-print-sheet]")) printSheet(target.dataset.printSheet);
  if (target.matches("[data-preview]")) {
    var sheet = tmState.sheets.find(function(item) { return String(item.id) === String(target.dataset.preview); });
    if (sheet) showEmailPreview(sheet);
  }
  if (target.matches("[data-mark-sent]")) markSent(target.dataset.markSent);
  if (target.matches("[data-delete]")) deleteSheet(target.dataset.delete);
});
loadData();
