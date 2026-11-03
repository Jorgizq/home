// Crea la planta y las áreas del diorama en Home Assistant y asigna cada luz a su área.
// Uso: abre Home Assistant en el navegador, pulsa F12 → Consola, pega este archivo entero y Enter.
// Usa la sesión del propio navegador (no necesita token). Es repetible: lo que ya existe no se duplica.
(async () => {
  const PLANTA = 'Vivienda';
  // nombre del área en HA → entidades que van en ella
  const AREAS = {
    'Salón': ['light.tele_izquierda', 'light.tele_derecha', 'light.sofa_1', 'light.sofa_2', 'light.sofa_3'],
    'Comedor': ['light.comedor_1', 'light.comedor_2'],
    'Hall': ['light.hall'],
    'Despacho': ['light.escritorio_1', 'light.escritorio_2', 'light.escritorio_3', 'light.entrada_despacho_1',
                 'light.entrada_despacho_2', 'light.armario_despacho_1', 'light.armario_despacho_2'],
    'Dormitorio': ['light.mesilla_jorge', 'light.mesilla_marta', 'light.foco_habitacion_1', 'light.foco_habitacion_2',
                   'light.foco_habitacion_3', 'light.foco_habitacion_4', 'light.foco_habitacion_5'],
    'Dormitorio peque': ['light.zeppelin'],
    'Pasillo': ['light.luz_pasillo'],
    'Distribuidor': [], 'Baño grande': [], 'Baño pequeño': [], 'Cocina': [], 'Tendedero': [],
  };
  const hass = document.querySelector('home-assistant').hass;
  const ws = (msg) => hass.callWS(msg);
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const log = [];
  // planta
  let floors = await ws({ type: 'config/floor_registry/list' });
  let floor = floors.find((f) => norm(f.name) === norm(PLANTA));
  if (!floor) { floor = await ws({ type: 'config/floor_registry/create', name: PLANTA, level: 1 }); log.push(`+ planta ${PLANTA}`); }
  // áreas
  let areas = await ws({ type: 'config/area_registry/list' });
  const ids = {};
  for (const nombre of Object.keys(AREAS)) {
    let a = areas.find((x) => norm(x.name) === norm(nombre));
    if (!a) { a = await ws({ type: 'config/area_registry/create', name: nombre, floor_id: floor.floor_id }); log.push(`+ área ${nombre} (${a.area_id})`); }
    else if (a.floor_id !== floor.floor_id) { await ws({ type: 'config/area_registry/update', area_id: a.area_id, floor_id: floor.floor_id }); log.push(`~ área ${nombre} → planta ${PLANTA}`); }
    else log.push(`= área ${nombre} ya existía (${a.area_id})`);
    ids[nombre] = a.area_id;
  }
  // luces
  for (const [nombre, ents] of Object.entries(AREAS)) {
    for (const e of ents) {
      try { await ws({ type: 'config/entity_registry/update', entity_id: e, area_id: ids[nombre] }); log.push(`  ${e} → ${nombre}`); }
      catch (err) { log.push(`! ${e}: ${err.message || JSON.stringify(err)}`); }
    }
  }
  console.log(log.join('\n'));
  console.log('Áreas (nombre → id):', JSON.stringify(ids, null, 1));
})();
