// Deja las áreas de Home Assistant igual que las estancias del diorama y asigna cada luz a su área.
// Uso: abre Home Assistant en el navegador, F12 → Consola, pega este archivo entero y pulsa Enter.
// Usa la sesión del propio navegador (sin token). Es repetible: lo que ya está bien no se toca.
(async () => {
  const PLANTA = 'Vivienda';
  const RENOMBRAR = { 'Dormitorio': 'Dormitorio principal' };  // áreas que ya existían con otro nombre
  const AREAS = {  // nombre del área → luces que van en ella
    'Salón': ['light.tele_izquierda', 'light.tele_derecha', 'light.sofa_1', 'light.sofa_2', 'light.sofa_3'],
    'Comedor': ['light.comedor_1', 'light.comedor_2'],
    'Hall': ['light.hall'],
    'Despacho': ['light.escritorio_1', 'light.escritorio_2', 'light.escritorio_3', 'light.entrada_despacho_1',
                 'light.entrada_despacho_2', 'light.armario_despacho_1', 'light.armario_despacho_2'],
    'Dormitorio principal': ['light.mesilla_jorge', 'light.mesilla_marta', 'light.foco_habitacion_1',
                             'light.foco_habitacion_2', 'light.foco_habitacion_3', 'light.foco_habitacion_4',
                             'light.foco_habitacion_5'],
    'Segundo dormitorio': ['light.zeppelin'],
    'Distribuidor': [],
    'Baño grande': [],
    'Baño pequeño': [],
    'Cocina': [],
    'Pasillo': ['light.luz_pasillo'],
    'Tendedero': [],
  };
  const hass = document.querySelector('home-assistant').hass;
  const ws = (msg) => hass.callWS(msg);
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const log = [];
  let floors = await ws({ type: 'config/floor_registry/list' });
  let floor = floors.find((f) => norm(f.name) === norm(PLANTA));
  if (!floor) { floor = await ws({ type: 'config/floor_registry/create', name: PLANTA, level: 1 }); log.push(`+ planta ${PLANTA}`); }
  let areas = await ws({ type: 'config/area_registry/list' });
  for (const [viejo, nuevo] of Object.entries(RENOMBRAR)) {
    const a = areas.find((x) => norm(x.name) === norm(viejo));
    if (a && !areas.some((x) => norm(x.name) === norm(nuevo))) {
      await ws({ type: 'config/area_registry/update', area_id: a.area_id, name: nuevo }); a.name = nuevo;
      log.push(`~ área ${viejo} → ${nuevo}`);
    }
  }
  const ids = {};
  for (const nombre of Object.keys(AREAS)) {
    let a = areas.find((x) => norm(x.name) === norm(nombre));
    if (!a) { a = await ws({ type: 'config/area_registry/create', name: nombre, floor_id: floor.floor_id }); log.push(`+ área ${nombre}`); }
    else if (a.floor_id !== floor.floor_id) { await ws({ type: 'config/area_registry/update', area_id: a.area_id, floor_id: floor.floor_id }); log.push(`~ área ${nombre} → planta ${PLANTA}`); }
    else log.push(`= área ${nombre}`);
    ids[nombre] = a.area_id;
  }
  for (const [nombre, ents] of Object.entries(AREAS)) {
    for (const e of ents) {
      try { await ws({ type: 'config/entity_registry/update', entity_id: e, area_id: ids[nombre] }); log.push(`  ${e} → ${nombre}`); }
      catch (err) { log.push(`! ${e}: ${err.message || JSON.stringify(err)}`); }
    }
  }
  const sobran = areas.filter((x) => !Object.keys(AREAS).some((n) => norm(n) === norm(x.name))).map((x) => x.name);
  if (sobran.length) log.push(`Áreas que no son del diorama (no se tocan): ${sobran.join(', ')}`);
  console.log(log.join('\n'));
  console.log('IDS ' + JSON.stringify(ids));
})();
