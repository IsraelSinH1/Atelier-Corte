import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export async function loadThreeModel(file, extension = file.name.split('.').pop()?.toLowerCase()) {
  let object;
  if (extension === 'obj') object = new OBJLoader().parse(await file.text());
  else if (['glb', 'gltf'].includes(extension)) {
    const buffer = await file.arrayBuffer();
    object = await new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', gltf => resolve(gltf.scene), reject));
  } else throw new Error('Usa un archivo .glb, .gltf o .obj.');
  const names = [];
  object.traverse(child => {
    if (child.isMesh) { child.userData.partName = child.name || `Parte ${names.length + 1}`; names.push(child.userData.partName); }
  });
  const unique = [...new Set(names)];
  if (!unique.length) throw new Error('No encontré partes visibles en ese archivo.');
  return { object, names: unique };
}

function materialFor(piece, sizeId, fabrics) {
  const override = piece?.materialsBySize?.[sizeId];
  const fabricId = override?.fabricId || piece?.fabricId;
  const colorId = override?.colorId || piece?.colorId;
  const color = fabrics.find(f => f.id === fabricId)?.colors?.find(c => c.id === colorId);
  return color?.hex ?? '#c8b49d';
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    child.traverse?.(object => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach(m => m.dispose?.());
      else object.material?.dispose?.();
    });
  }
}

export default function ThreeViewer({ product, size, fabrics, mode, importedModel, mappings, selectedPieceId, onSelectPiece }) {
  const mountRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const modelRootRef = useRef(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const downRef = useRef(null);

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#f5f2ec');
    const camera = new THREE.PerspectiveCamera(40, 1, .01, 100); camera.position.set(2.8, 2.5, 3.5);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.domElement.className = 'three-canvas'; host.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xfffaf3, 0x6f6356, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(4, 6, 4); key.castShadow = true; scene.add(key);
    const fill = new THREE.DirectionalLight(0xf0c9b5, 1.1); fill.position.set(-4, 2, -3); scene.add(fill);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: '#ebe6dd', roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -.12; floor.receiveShadow = true; scene.add(floor);
    const grid = new THREE.GridHelper(5, 20, '#c8c0b5', '#ddd7ce'); grid.position.y = -.115; grid.material.opacity = .35; grid.material.transparent = true; scene.add(grid);
    const root = new THREE.Group(); scene.add(root);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .08; controls.enablePan = true; controls.minDistance = 1.4; controls.maxDistance = 9; controls.target.set(0, .35, 0);
    const resize = () => { const width = host.clientWidth || 640; const height = host.clientHeight || 460; camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    let frame = 0; const animate = () => { frame = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }; animate();
    const pointerDown = e => { downRef.current = { x: e.clientX, y: e.clientY }; };
    const pointerUp = e => {
      if (!downRef.current || Math.hypot(e.clientX - downRef.current.x, e.clientY - downRef.current.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointerRef.current.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      const hit = raycasterRef.current.intersectObjects(root.children, true).find(item => item.object.userData.pieceId);
      if (hit?.object.userData.pieceId) onSelectPiece(hit.object.userData.pieceId);
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerup', pointerUp);
    cameraRef.current = camera; controlsRef.current = controls; modelRootRef.current = root;
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', pointerUp); clearGroup(root); renderer.dispose(); host.removeChild(renderer.domElement);
    };
  }, [onSelectPiece]);

  useEffect(() => {
    const root = modelRootRef.current; const camera = cameraRef.current; const controls = controlsRef.current;
    if (!root || !camera || !controls) return;
    clearGroup(root);
    const pieces = product?.pieces ?? []; const sizeId = size?.id;
    const makeMaterial = piece => new THREE.MeshStandardMaterial({
      color: materialFor(piece, sizeId, fabrics), roughness: .88, metalness: .02, side: THREE.DoubleSide,
      emissive: selectedPieceId === piece?.id ? '#d7a17f' : '#000000', emissiveIntensity: selectedPieceId === piece?.id ? .22 : 0,
    });
    const dims = piece => piece?.measures?.[sizeId] ?? { length: 50, width: 40 };
    const addMesh = (geometry, piece, name, position = [0, 0, 0]) => {
      const object = new THREE.Mesh(geometry, makeMaterial(piece)); object.position.set(...position); object.castShadow = true; object.receiveShadow = true; object.userData.pieceId = piece?.id; object.userData.partName = name; root.add(object); return object;
    };
    const roundedPanel = (width, length, height, radius = Math.min(width, length) * .12) => {
      const x = -width / 2; const z = -length / 2; const r = Math.min(radius, width / 2, length / 2);
      const shape = new THREE.Shape();
      shape.moveTo(x + r, z); shape.lineTo(x + width - r, z); shape.quadraticCurveTo(x + width, z, x + width, z + r);
      shape.lineTo(x + width, z + length - r); shape.quadraticCurveTo(x + width, z + length, x + width - r, z + length);
      shape.lineTo(x + r, z + length); shape.quadraticCurveTo(x, z + length, x, z + length - r);
      shape.lineTo(x, z + r); shape.quadraticCurveTo(x, z, x + r, z);
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: Math.max(.04, height * .66), bevelEnabled: true, bevelSegments: 4, steps: 1, bevelSize: Math.min(height * .16, r * .18), bevelThickness: Math.max(.015, height * .17), curveSegments: 8 });
      geometry.translate(0, 0, -geometry.parameters.options.depth / 2);
      geometry.rotateX(-Math.PI / 2);
      geometry.computeVertexNormals();
      return geometry;
    };
    let view = mode;
    if (view === 'auto') { const label = `${product?.name ?? ''} ${product?.description ?? ''}`.toLowerCase(); view = /bolso|bolsa|mochila/.test(label) ? 'bag' : /coj[ií]n|funda|almohada/.test(label) ? 'pillow' : 'bed'; }
    if (view === 'imported' && importedModel) {
      const object = importedModel.clone(true);
      object.traverse(child => {
        if (!child.isMesh) return;
        child.geometry = child.geometry.clone();
        const partName = child.userData.partName || child.name || '';
        const piece = pieces.find(item => item.id === mappings?.[partName]);
        child.userData.pieceId = piece?.id;
        if (piece) child.material = makeMaterial(piece);
        else if (child.material) child.material = Array.isArray(child.material) ? child.material.map(m => m.clone()) : child.material.clone();
        child.castShadow = true; child.receiveShadow = true;
      });
      const box = new THREE.Box3().setFromObject(object); const center = box.getCenter(new THREE.Vector3()); const size3 = box.getSize(new THREE.Vector3()); const minY = box.min.y; const maxDim = Math.max(size3.x, size3.y, size3.z) || 1;
      object.position.sub(center); object.position.y -= minY - center.y; object.scale.multiplyScalar(2.05 / maxDim); root.add(object);
    } else if (view === 'pillow' || view === 'bag') {
      const piece = pieces[0]; const m = dims(piece); const w = Math.max(.65, m.width * .035); const l = Math.max(.65, m.length * .035); const h = Math.max(.24, Math.min(w, l) * (view === 'bag' ? .7 : .28));
      const body = addMesh(roundedPanel(w, l, h), piece, piece?.name ?? 'Cuerpo', [0, h / 2, 0]);
      if (view === 'bag') { body.material.roughness = .94; const strap = pieces[1] ?? piece; const radius = w * .2; const tube = Math.max(.025, w * .018); const handle = addMesh(new THREE.TorusGeometry(radius, tube, 10, 36, Math.PI), strap, strap?.name ?? 'Asa', [0, h + radius * .62, 0]); handle.rotation.x = Math.PI / 2; }
    } else if (view === 'assembled') {
      pieces.forEach((piece, index) => { const m = dims(piece); const w = Math.max(.36, m.width * .026); const l = Math.max(.36, m.length * .026); const h = Math.max(.12, Math.min(w, l) * .18); const geometry = piece.shape === 'circle' ? new THREE.CylinderGeometry(Math.min(w, l) / 2, Math.min(w, l) / 2, h, 48) : new THREE.BoxGeometry(w, h, l); const offset = index - (pieces.length - 1) / 2; addMesh(geometry, piece, piece.name, [offset * 1.2, h / 2, 0]); });
    } else {
      const base = pieces[0]; const cushion = pieces[1] ?? base; const rim = pieces[2] ?? base; const baseM = dims(base); const scale = .035;
      const width = Math.max(.8, (baseM.width || baseM.length || 50) * scale); const length = Math.max(.8, (baseM.length || baseM.width || 50) * scale); const radius = Math.min(width, length) / 2;
      const baseY = .11; const baseThickness = .2; const rimHeight = Math.max(.23, (dims(rim).width || 22) * scale * .48);
      const baseGeometry = base?.shape === 'circle' ? new THREE.CylinderGeometry(radius, radius, baseThickness, 64) : roundedPanel(width, length, baseThickness, .22);
      addMesh(baseGeometry, base, base?.name ?? 'Base inferior', [0, baseY, 0]);
      const cushionM = dims(cushion); const cushionW = Math.min(width * .84, Math.max(.55, (cushionM.width || cushionM.length || baseM.width) * scale)); const cushionL = Math.min(length * .84, Math.max(.55, (cushionM.length || cushionM.width || baseM.length) * scale));
      const cushionY = baseY + baseThickness / 2 + .07;
      const cushionGeometry = cushion?.shape === 'circle' ? new THREE.CylinderGeometry(Math.min(cushionW, cushionL) / 2, Math.min(cushionW, cushionL) / 2, .19, 64) : roundedPanel(cushionW, cushionL, .22, .2);
      addMesh(cushionGeometry, cushion, cushion?.name ?? 'Cojín superior', [0, cushionY, 0]);
      const outerRadius = Math.max(.35, radius * .93); const tube = Math.min(rimHeight * .36, radius * .22);
      const ring = addMesh(new THREE.TorusGeometry(outerRadius - tube * .2, tube, 16, 72), rim, rim?.name ?? 'Borde acolchado', [0, cushionY + .05, 0]); ring.rotation.x = Math.PI / 2;
      const stitch = addMesh(new THREE.TorusGeometry(outerRadius - tube * .68, .012, 6, 72), rim, 'Costura del borde', [0, cushionY + .05 + tube * .78, 0]); stitch.rotation.x = Math.PI / 2;
    }
    const bounds = new THREE.Box3().setFromObject(root); const sizeBox = bounds.getSize(new THREE.Vector3()); const maxSize = Math.max(sizeBox.x, sizeBox.y, sizeBox.z, 1); const center = bounds.getCenter(new THREE.Vector3());
    controls.target.set(center.x, Math.max(.05, center.y), center.z); camera.position.set(maxSize * 1.45, maxSize * 1.12, maxSize * 1.75); camera.near = maxSize / 100; camera.far = maxSize * 30; camera.updateProjectionMatrix(); controls.update();
  }, [product, size, fabrics, mode, importedModel, mappings, selectedPieceId]);

  return <div className="three-viewer" ref={mountRef}><div className="viewer-axis"><span>X</span><span>Y</span><span>Z</span></div></div>;
}
