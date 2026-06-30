var tmState = { sheets: [], activeSheetId: null, useSupabase: false };
var supabaseClient = null;
var storageKey = "tm_sheets_v1";
function $(selector) { return document.querySelector(selector); }
function esc(value) { return String(value == null ? "" : value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
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
function configured() { return window.MATERIAL_APP_SUPABASE_URL && !window.MATERIAL_APP_SUPABASE_URL.includes("PASTE_") && window.MATERIAL_APP_SUPABASE_ANON_KEY && !window.MATERIAL_APP_SUPABASE_ANON_KEY.includes("PASTE_") && window.supabase; }
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
function sheetTotal(sheet) { return employeeLaborTotal(sheet) + Number(sheet.material_cost || 0) + equipmentTotal(sheet); }
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
    sheet.materials || "N/A",
    "Material Cost: " + money(sheet.material_cost),
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
    supabaseClient = window.supabase.createClient(window.MATERIAL_APP_SUPABASE_URL, window.MATERIAL_APP_SUPABASE_ANON_KEY);
    var result = await supabaseClient.from("time_material_sheets").select("*").order("created_at", { ascending: false });
    if (!result.error) { tmState.useSupabase = true; tmState.sheets = result.data || []; $("#setupWarning").hidden = true; render(); return; }
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
    materials: $("#materials").value.trim(),
    material_cost: numberValue("#materialCost"),
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
    var result = await supabaseClient.from("time_material_sheets").insert(payload).select().single();
    if (result.error) return alert(result.error.message);
    saved = result.data;
  } else {
    tmState.sheets.unshift(sheet);
    localSave();
  }
  $("#tmForm").reset();
  $("#project").value = "";
  $("#workDate").value = new Date().toISOString().slice(0, 10);
  resetEmployees();
  resetEquipment();
  clearSignature();
  await loadData();
  showEmailPreview(saved);
}
async function markSent(id) {
  if (tmState.useSupabase) {
    var result = await supabaseClient.from("time_material_sheets").update({ email_sent: true }).eq("id", id);
    if (result.error) return alert(result.error.message);
  } else {
    tmState.sheets = tmState.sheets.map(function(sheet) { return String(sheet.id) === String(id) ? Object.assign({}, sheet, { email_sent: true }) : sheet; });
    localSave();
  }
  await loadData();
}
async function deleteSheet(id) {
  if (tmState.useSupabase) {
    var result = await supabaseClient.from("time_material_sheets").delete().eq("id", id);
    if (result.error) return alert(result.error.message);
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
    return '<tr><td>' + esc(sheet.work_date) + '</td><td><strong>' + esc(sheet.sheet_number || "Job") + '</strong><br><span class="muted">' + esc(sheet.project || "") + '</span></td><td class="work-text">' + esc(sheet.work_performed) + '<br><span class="muted">' + esc(sheet.location || "") + '</span></td><td>' + esc(employeeHoursTotal(sheet)) + '<br><span class="muted">' + esc(employeeNames(sheet) || sheet.crew || '') + '</span></td><td>' + money(sheetTotal(sheet)) + '</td><td><span class="badge ' + statusClass + '">' + statusText + '</span></td><td><div class="row"><a class="btn primary" href="' + email.href + '">Open Draft</a><button class="btn" type="button" data-preview="' + esc(sheet.id) + '">Preview</button><button class="btn" type="button" data-mark-sent="' + esc(sheet.id) + '">Mark Sent</button><button class="btn danger" type="button" data-delete="' + esc(sheet.id) + '">Delete</button></div></td></tr>';
  }).join("") || '<tr><td colspan="7">No T&M sheets logged yet.</td></tr>';
}
function exportCsv() {
  var headers = ["Date", "Job Number", "Project", "Requested By", "Location", "Work Performed", "Employees", "Labor Hours", "Labor Total", "Materials", "Material Cost", "Equipment / Other", "Equipment / Other Total", "Send To", "Notes", "Signed", "Email Sent"];
  var rows = tmState.sheets.map(function(sheet) { return [sheet.work_date, sheet.sheet_number, sheet.project, sheet.requested_by, sheet.location, sheet.work_performed, employeeEmailLines(sheet).join("; "), employeeHoursTotal(sheet), employeeLaborTotal(sheet), sheet.materials, sheet.material_cost, equipmentEmailLines(sheet).join("; "), equipmentTotal(sheet), sheet.send_to, sheet.notes, sheet.signature_data ? "Yes" : "No", sheet.email_sent ? "Yes" : "No"]; });
  var csv = [headers].concat(rows).map(function(row) { return row.map(function(value) { return '"' + String(value == null ? "" : value).replaceAll('"', '""') + '"'; }).join(","); }).join("\n");
  var link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = "tm-sheets.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}
$("#workDate").value = new Date().toISOString().slice(0, 10);
setupSignaturePad();
resetEmployees();
resetEquipment();
$("#addEmployee").addEventListener("click", function() { addEmployeeRow(); });
$("#addEquipment").addEventListener("click", function() { addEquipmentRow(); });
$("#tmForm").addEventListener("submit", addSheet);
$("#search").addEventListener("input", render);
$("#exportCsv").addEventListener("click", exportCsv);
$("#clearSignature").addEventListener("click", clearSignature);
$("#markPreviewSent").addEventListener("click", function() { if (tmState.activeSheetId) markSent(tmState.activeSheetId); });
document.addEventListener("click", function(event) {
  var target = event.target;
  if (target.matches("[data-remove-employee]")) {
    if (employeeRows().length > 1) target.closest(".employee-row").remove();
  }
  if (target.matches("[data-remove-equipment]")) {
    if (equipmentRows().length > 1) target.closest(".equipment-row").remove();
  }
  if (target.matches("[data-preview]")) {
    var sheet = tmState.sheets.find(function(item) { return String(item.id) === String(target.dataset.preview); });
    if (sheet) showEmailPreview(sheet);
  }
  if (target.matches("[data-mark-sent]")) markSent(target.dataset.markSent);
  if (target.matches("[data-delete]")) deleteSheet(target.dataset.delete);
});
loadData();