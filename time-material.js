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
function ensurePrintedNameField() {
  if ($("#printedName")) return;
  var signatureSection = document.querySelector(".signature-section");
  if (!signatureSection) return;
  var label = document.createElement("label");
  label.innerHTML = 'Printed name<input id="printedName" placeholder="Printed name">';
  signatureSection.appendChild(label);
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
    "Signature: " + (sheet.signature_data ? "Signed" : "Not signed"),
    "Printed Name: " + (sheet.printed_name || "N/A")
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
    printed_name: $("#printedName").value.trim(),
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
  $("#printedName").value = "";
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

function crc32(bytes) {
  var table = crc32.table || (crc32.table = Array.from({ length: 256 }, function(_, n) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    return c >>> 0;
  }));
  var crc = -1;
  for (var i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}
function utf8Bytes(text) { return new TextEncoder().encode(text); }
function concatBytes(parts) {
  var length = parts.reduce(function(total, part) { return total + part.length; }, 0);
  var out = new Uint8Array(length);
  var offset = 0;
  parts.forEach(function(part) { out.set(part, offset); offset += part.length; });
  return out;
}
function u16(value) { return new Uint8Array([value & 255, (value >>> 8) & 255]); }
function u32(value) { return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]); }
function makeZip(entries) {
  var localParts = [];
  var centralParts = [];
  var offset = 0;
  entries.forEach(function(entry) {
    var name = utf8Bytes(entry.name);
    var data = entry.bytes || utf8Bytes(entry.text || '');
    var crc = crc32(data);
    var local = concatBytes([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    localParts.push(local);
    var central = concatBytes([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]);
    centralParts.push(central);
    offset += local.length;
  });
  var central = concatBytes(centralParts);
  var local = concatBytes(localParts);
  var end = concatBytes([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(local.length), u16(0)]);
  return new Blob([local, central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function colName(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function xlsxCell(row, col, value, style, formula) {
  var ref = colName(col) + row;
  var attrs = ' r="' + ref + '"' + (style ? ' s="' + style + '"' : '');
  if (formula) return '<c' + attrs + '><f>' + xmlEscape(formula) + '</f></c>';
  if (typeof value === 'number') return '<c' + attrs + '><v>' + value + '</v></c>';
  return '<c' + attrs + ' t="inlineStr"><is><t>' + xmlEscape(value == null ? '' : value) + '</t></is></c>';
}
function xlsxRow(rowNum, cells, height) {
  return '<row r="' + rowNum + '"' + (height ? ' ht="' + height + '" customHeight="1"' : '') + '>' + cells.join('') + '</row>';
}
function pngBytesFromDataUrl(dataUrl) {
  if (!dataUrl) return null;
  var base64 = dataUrl.split(',')[1] || '';
  var binary = atob(base64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function makeXlsxBlob(sheet) {
  var employees = getEmployees(sheet);
  var materials = getMaterialItems(sheet);
  var equipment = getEquipmentItems(sheet);
  var rows = [];
  var r = 1;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'ELLIOTT ELECTRIC INC.',12)])); r++;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'TIME AND MATERIAL SHEET',1)])); r++;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Project',2), xlsxCell(r,2,sheet.project || ''), xlsxCell(r,3,'Job Number',2), xlsxCell(r,4,sheet.sheet_number || '')])); r++;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Date',2), xlsxCell(r,2,sheet.work_date || ''), xlsxCell(r,3,'Requested By',2), xlsxCell(r,4,sheet.requested_by || '')])); r++;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Location',2), xlsxCell(r,2,sheet.location || ''), xlsxCell(r,3,'Signed',2), xlsxCell(r,4,sheet.signature_data ? 'Yes' : 'No')])); r++;
  rows.push(xlsxRow(r, [])); r++;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Work Performed',3)])); r++;
  rows.push(xlsxRow(r, [xlsxCell(r,1,sheet.work_performed || '',4)], 45)); r++;
  rows.push(xlsxRow(r, [])); r++;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Employees',3)])); r++;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Name',5), xlsxCell(r,2,'Hours',5), xlsxCell(r,3,'Rate',5), xlsxCell(r,4,'Total',5)])); r++;
  var employeeStart = r;
  (employees.length ? employees : [{name:'',hours:0,rate:0}]).forEach(function(e) { rows.push(xlsxRow(r, [xlsxCell(r,1,e.name || ''), xlsxCell(r,2,Number(e.hours || 0),6), xlsxCell(r,3,Number(e.rate || 0),7), xlsxCell(r,4,null,7,'B'+r+'*C'+r)])); r++; });
  var employeeEnd = r - 1;
  var laborTotalRow = r;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Labor Total',8), xlsxCell(r,2,''), xlsxCell(r,3,''), xlsxCell(r,4,null,9,'SUM(D'+employeeStart+':D'+employeeEnd+')')])); r++;
  rows.push(xlsxRow(r, [])); r++;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Material Used',3)])); r++;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Material',5), xlsxCell(r,2,'Amount Used',5), xlsxCell(r,3,'Unit Price',5), xlsxCell(r,4,'Total',5)])); r++;
  var materialStart = r;
  (materials.length ? materials : [{description:'',amount:0,unit_price:0}]).forEach(function(m) { rows.push(xlsxRow(r, [xlsxCell(r,1,m.description || ''), xlsxCell(r,2,Number(m.amount || 0),6), xlsxCell(r,3,Number(m.unit_price || 0),7), xlsxCell(r,4,null,7,'B'+r+'*C'+r)])); r++; });
  var materialEnd = r - 1;
  var materialTotalRow = r;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Material Total',8), xlsxCell(r,2,''), xlsxCell(r,3,''), xlsxCell(r,4,null,9,'SUM(D'+materialStart+':D'+materialEnd+')')])); r++;
  rows.push(xlsxRow(r, [])); r++;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Equipment / Other',3)])); r++;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Description',5), xlsxCell(r,2,''), xlsxCell(r,3,''), xlsxCell(r,4,'Cost',5)])); r++;
  var equipmentStart = r;
  (equipment.length ? equipment : [{description:'',cost:0}]).forEach(function(eq) { rows.push(xlsxRow(r, [xlsxCell(r,1,eq.description || ''), xlsxCell(r,2,''), xlsxCell(r,3,''), xlsxCell(r,4,Number(eq.cost || 0),7)])); r++; });
  var equipmentEnd = r - 1;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Equipment / Other Total',8), xlsxCell(r,2,''), xlsxCell(r,3,''), xlsxCell(r,4,null,9,'SUM(D'+equipmentStart+':D'+equipmentEnd+')')])); r++;
  var equipmentTotalRow = r - 1;
  var markupRow = r;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Markup on Material',8), xlsxCell(r,2,'Percent'), xlsxCell(r,3,0,13), xlsxCell(r,4,null,9,'D'+materialTotalRow+'*C'+r)])); r++;
  var taxRow = r;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Taxes',8), xlsxCell(r,2,'Percent'), xlsxCell(r,3,0,13), xlsxCell(r,4,null,9,'(D'+laborTotalRow+'+D'+materialTotalRow+'+D'+equipmentTotalRow+'+D'+markupRow+')*C'+r)])); r++;
  rows.push(xlsxRow(r, [])); r++;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Grand Total',10), xlsxCell(r,2,''), xlsxCell(r,3,''), xlsxCell(r,4,null,11,'D'+laborTotalRow+'+D'+materialTotalRow+'+D'+equipmentTotalRow+'+D'+markupRow+'+D'+taxRow)])); r++;
  rows.push(xlsxRow(r, [])); r++;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Notes',3)])); r++;
  rows.push(xlsxRow(r, [xlsxCell(r,1,sheet.notes || '',4)], 35)); r++;
  rows.push(xlsxRow(r, [xlsxCell(r,1,'Authorized Signature',2), xlsxCell(r,2,''), xlsxCell(r,3,'Printed Name / Date',2), xlsxCell(r,4,'')])); r++;
  var sigRow = r;
  rows.push(xlsxRow(r, [xlsxCell(r,1,''), xlsxCell(r,2,''), xlsxCell(r,3,sheet.printed_name || ''), xlsxCell(r,4,'')], 80)); r++;
  var hasSig = !!sheet.signature_data;
  var sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="16" customWidth="1"/><col min="3" max="3" width="16" customWidth="1"/><col min="4" max="4" width="18" customWidth="1"/></cols><sheetData>' + rows.join('') + '</sheetData>' + (hasSig ? '<drawing r:id="rId1"/>' : '') + '</worksheet>';
  var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="$#,##0.00"/><numFmt numFmtId="165" formatCode="0.00"/><numFmt numFmtId="166" formatCode="0.00%"/></numFmts><fonts count="4"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="18"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF111111"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9EEEC"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE4E1"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders><cellXfs count="14"><xf fontId="0" fillId="0" borderId="1" xfId="0"/><xf fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1"/><xf fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1"/><xf fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1"/><xf fontId="0" fillId="0" borderId="1" xfId="0" numFmtId="165" applyNumberFormat="1"/><xf fontId="0" fillId="0" borderId="1" xfId="0" numFmtId="164" applyNumberFormat="1"/><xf fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1"/><xf fontId="3" fillId="3" borderId="1" xfId="0" numFmtId="164" applyFont="1" applyFill="1" applyNumberFormat="1"/><xf fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1"/><xf fontId="3" fillId="4" borderId="1" xfId="0" numFmtId="164" applyFont="1" applyFill="1" applyNumberFormat="1"/><xf fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf fontId="0" fillId="0" borderId="1" xfId="0" numFmtId="166" applyNumberFormat="1"/></cellXfs></styleSheet>';
  var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + (hasSig ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '') + '</Types>';
  var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="T&amp;M Sheet" sheetId="1" r:id="rId1"/></sheets></workbook>';
  var workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  var entries = [{name:'[Content_Types].xml', text:contentTypes},{name:'_rels/.rels', text:rels},{name:'xl/workbook.xml', text:workbook},{name:'xl/_rels/workbook.xml.rels', text:workbookRels},{name:'xl/styles.xml', text:styles},{name:'xl/worksheets/sheet1.xml', text:sheetXml}];
  if (hasSig) {
    var drawing = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>100000</xdr:colOff><xdr:row>'+(sigRow-1)+'</xdr:row><xdr:rowOff>100000</xdr:rowOff></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>'+(sigRow+1)+'</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Signature"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>';
    var drawingRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/signature.png"/></Relationships>';
    var sheetRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>';
    entries.push({name:'xl/worksheets/_rels/sheet1.xml.rels', text:sheetRels},{name:'xl/drawings/drawing1.xml', text:drawing},{name:'xl/drawings/_rels/drawing1.xml.rels', text:drawingRels},{name:'xl/media/signature.png', bytes:pngBytesFromDataUrl(sheet.signature_data)});
  }
  return makeZip(entries);
}
function excelFileName(sheet) {
  var baseName = ['TM', sheet.sheet_number || 'sheet', sheet.work_date || ''].join('-').replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-');
  return baseName + '.xlsx';
}
function downloadExcelSheet(id) {
  var sheet = tmState.sheets.find(function(item) { return String(item.id) === String(id); });
  if (!sheet) return;
  var link = document.createElement('a');
  link.href = URL.createObjectURL(makeXlsxBlob(sheet));
  link.download = excelFileName(sheet);
  link.click();
  URL.revokeObjectURL(link.href);
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
ensurePrintedNameField();
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
