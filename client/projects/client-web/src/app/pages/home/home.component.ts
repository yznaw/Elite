import {
  AfterViewInit,
  Component,
  computed,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { I18nService } from '../../services/i18n.service';
import { HomeContentService } from '../../services/home-content.service';
import { HomeCollectionTileContent } from '../../models/home-content.model';

interface MetaCard {
  id: number;
  labelKey: string;
  subKey: string;
  icon: string;
}

interface PromiseStat {
  value: string;
  labelKey: string;
}

interface LeatherColorOption {
  id: string;
  nameKey: string;
  color: number;
  swatch: string;
}

interface HeroModelOption {
  id: string;
  index: string;
  eyebrowKey: string;
  titleKey: string;
  subtitleKey: string;
  url: string;
}

@Component({
  selector: 'cw-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly ngZone = inject(NgZone);
  private readonly i18n = inject(I18nService);
  private readonly homeContent = inject(HomeContentService);

  private metaTimer: number | undefined;
  private resizeObserver?: ResizeObserver;
  private animationFrame = 0;
  private renderer?: THREE.WebGLRenderer;
  private environmentRenderTarget?: THREE.WebGLRenderTarget;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private controls?: OrbitControls;
  private dracoLoader?: DRACOLoader;
  private model?: THREE.Object3D;
  private modelYaw = 0;
  private isDraggingModel = false;
  private lastPointerX = 0;
  private swipeStartX = 0;
  private swipeStartY = 0;
  private swipeStartAt = 0;
  private modelLoadToken = 0;
  private readonly referenceMaterialColors = {
    leather: 0x5f3423,
    leatherDeep: 0x4e2c22,
    footbed: 0x8f6337,
    stitch: 0x3f2419,
    buckle: 0x4b2d23,
  };
  private readonly handleModelPointerDown = (event: PointerEvent): void => this.onModelPointerDown(event);
  private readonly handleModelPointerMove = (event: PointerEvent): void => this.onModelPointerMove(event);
  private readonly handleModelPointerUp = (event: PointerEvent): void => this.onModelPointerUp(event);
  private readonly leatherMaterials: THREE.MeshStandardMaterial[] = [];

  @ViewChild('heroCanvas') private heroCanvas?: ElementRef<HTMLCanvasElement>;

  readonly metaVisible = signal(false);
  readonly modelLoaded = signal(false);
  readonly modelLoadFailed = signal(false);
  readonly selectedModelId = signal('original');
  readonly selectedLeatherColor = signal('cognac');
  readonly contentData = this.homeContent.contentData;
  readonly layoutSections = this.homeContent.layoutSections;

  readonly heroModels: HeroModelOption[] = [
    {
      id: 'original',
      index: '01',
      eyebrowKey: 'home.hero.original.eyebrow',
      titleKey: 'home.hero.original.title',
      subtitleKey: 'home.hero.original.subtitle',
      url: '/assets/models/latest-brown-v2.glb',
    },
    {
      id: 'or9',
      index: '02',
      eyebrowKey: 'home.hero.or9.eyebrow',
      titleKey: 'home.hero.or9.title',
      subtitleKey: 'home.hero.or9.subtitle',
      url: '/assets/models/or9.glb',
    },
    {
      id: 'or4',
      index: '03',
      eyebrowKey: 'home.hero.or4.eyebrow',
      titleKey: 'home.hero.or4.title',
      subtitleKey: 'home.hero.or4.subtitle',
      url: '/assets/models/or4.glb',
    },
    {
      id: 'or8',
      index: '04',
      eyebrowKey: 'home.hero.or8.eyebrow',
      titleKey: 'home.hero.or8.title',
      subtitleKey: 'home.hero.or8.subtitle',
      url: '/assets/models/or8.glb',
    },
  ];

  readonly activeHeroModel = computed(
    () => this.heroModels.find((model) => model.id === this.selectedModelId()) ?? this.heroModels[0],
  );

  readonly leatherColors: LeatherColorOption[] = [
    { id: 'cognac', nameKey: 'home.leatherColor.cognac', color: 0x5f3423, swatch: '#5f3423' },
    { id: 'espresso', nameKey: 'home.leatherColor.espresso', color: 0x4e2c22, swatch: '#4e2c22' },
    { id: 'sand', nameKey: 'home.leatherColor.sand', color: 0x8f6337, swatch: '#8f6337' },
  ];

  readonly metaCards: MetaCard[] = [
    { id: 1, labelKey: 'home.meta.handStitched', subKey: 'home.meta.handStitched.sub', icon: '◊' },
    { id: 2, labelKey: 'home.meta.camelLeather', subKey: 'home.meta.camelLeather.sub', icon: '◆' },
    { id: 3, labelKey: 'home.meta.craftingTime', subKey: 'home.meta.craftingTime.sub', icon: '◈' },
  ];

  readonly stats: PromiseStat[] = [
    { value: '60+', labelKey: 'home.stats.heritage' },
    { value: '12',  labelKey: 'home.stats.artisans' },
    { value: '48hr', labelKey: 'home.stats.perPair' },
    { value: '∞',   labelKey: 'home.stats.lifetime' },
  ];

  readonly t = (key: string, params?: Record<string, string | number>): string => this.i18n.t(key, params);

  ngOnInit(): void {
    void this.homeContent.refresh(true);
    this.metaTimer = window.setTimeout(() => this.metaVisible.set(true), 1800);
  }

  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => this.initHeroModel());
  }

  ngOnDestroy(): void {
    if (this.metaTimer) clearTimeout(this.metaTimer);
    this.destroyHeroModel();
  }

  goTo(path: string): void {
    void this.router.navigate([path]);
    window.scrollTo(0, 0);
  }

  goToContentLink(link: string): void {
    const target = link?.trim() || '/collection';
    if (/^https?:\/\//i.test(target)) {
      window.location.href = target;
      return;
    }

    void this.router.navigateByUrl(target);
    window.scrollTo(0, 0);
  }

  goToCollectionTile(tile: HomeCollectionTileContent): void {
    this.goToContentLink(this.collectionTileRoute(tile));
  }

  selectLeatherColor(id: string): void {
    this.selectedLeatherColor.set(id);
    this.applyLeatherColor(id);
  }

  selectHeroModel(id: string): void {
    if (this.selectedModelId() === id) return;

    this.selectedModelId.set(id);
    this.modelLoaded.set(false);
    this.modelLoadFailed.set(false);

    if (this.scene && this.controls) {
      this.loadHeroModel(this.scene, this.controls);
    }
  }

  selectAdjacentHeroModel(direction: -1 | 1): void {
    const currentIndex = this.heroModels.findIndex((model) => model.id === this.selectedModelId());
    const nextIndex = (currentIndex + direction + this.heroModels.length) % this.heroModels.length;
    this.selectHeroModel(this.heroModels[nextIndex].id);
  }

  private collectionTileRoute(tile: HomeCollectionTileContent): string {
    const link = tile.link?.trim();
    if (link && /^https?:\/\//i.test(link)) return link;

    const fallbackHandle = this.collectionHandle(tile.id || tile.title);
    if (!link) return `/collection/${fallbackHandle}`;

    try {
      const url = new URL(link, window.location.origin);
      const detailMatch = url.pathname.match(/^\/collection\/([^/?#]+)/);
      if (detailMatch?.[1]) return `/collection/${detailMatch[1]}`;

      if (url.pathname === '/collection') {
        const collectionKey = url.searchParams.get('collection');
        if (collectionKey) return `/collection/${this.collectionHandle(collectionKey)}`;

        const key = tile.title || tile.id || url.searchParams.get('category') || fallbackHandle;
        return `/collection/${this.collectionHandle(key)}`;
      }
    } catch {
      return `/collection/${fallbackHandle}`;
    }

    return link;
  }

  private collectionHandle(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'collection';
  }

  private initHeroModel(): void {
    const canvas = this.heroCanvas?.nativeElement;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.38, 4.05);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.78;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.enableRotate = false;
    controls.enableZoom = false;
    controls.autoRotate = false;
    controls.rotateSpeed = 0.82;
    controls.minDistance = 2.35;
    controls.maxDistance = 5.8;
    controls.minPolarAngle = Math.PI / 3.1;
    controls.maxPolarAngle = Math.PI / 1.95;
    controls.target.set(0, 0, 0);

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;

    this.addHeroLighting(scene);
    this.addHeroEnvironment(scene, renderer);
    this.addHeroGround(scene);
    this.bindHeroResize(host);
    this.bindModelDrag(canvas);
    this.loadHeroModel(scene, controls);
    this.animateHero();
  }

  private addHeroLighting(scene: THREE.Scene): void {
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcaa77a, 0.74));

    const keyLight = new THREE.DirectionalLight(0xfffbf2, 1.62);
    keyLight.position.set(3.6, 5.4, 4.6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 18;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xf4dfb7, 0.24);
    fillLight.position.set(-4.2, 2.2, 2.6);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.72);
    rimLight.position.set(-2.6, 3.8, -3.8);
    scene.add(rimLight);
  }

  private addHeroEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();

    this.environmentRenderTarget = pmremGenerator.fromScene(roomEnvironment, 0.015);
    scene.environment = this.environmentRenderTarget.texture;
    roomEnvironment.dispose();
    pmremGenerator.dispose();
  }

  private addHeroGround(scene: THREE.Scene): void {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(2.85, 96),
      new THREE.ShadowMaterial({ color: 0x3a281a, opacity: 0.26 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.72;
    shadow.receiveShadow = true;
    scene.add(shadow);
  }

  private bindHeroResize(host: HTMLElement): void {
    const resize = (): void => {
      if (!this.renderer || !this.camera) return;

      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setSize(width, height, false);
    };

    resize();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(host);
  }

  private bindModelDrag(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', this.handleModelPointerDown);
    window.addEventListener('pointermove', this.handleModelPointerMove, { passive: true });
    window.addEventListener('pointerup', this.handleModelPointerUp);
    window.addEventListener('pointercancel', this.handleModelPointerUp);
  }

  private onModelPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    this.isDraggingModel = true;
    this.lastPointerX = event.clientX;
    this.swipeStartX = event.clientX;
    this.swipeStartY = event.clientY;
    this.swipeStartAt = window.performance.now();
    this.heroCanvas?.nativeElement.setPointerCapture?.(event.pointerId);
  }

  private onModelPointerMove(event: PointerEvent): void {
    if (!this.isDraggingModel || !this.model) return;

    const deltaX = event.clientX - this.lastPointerX;
    this.lastPointerX = event.clientX;
    this.modelYaw += deltaX * 0.01;
    this.model.rotation.y = this.modelYaw;
  }

  private onModelPointerUp(event: PointerEvent): void {
    if (!this.isDraggingModel) return;

    this.isDraggingModel = false;
    this.selectSwipedHeroModel(event);
    const canvas = this.heroCanvas?.nativeElement;
    if (canvas?.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  private selectSwipedHeroModel(event: PointerEvent): void {
    const deltaX = event.clientX - this.swipeStartX;
    const deltaY = event.clientY - this.swipeStartY;
    const elapsed = window.performance.now() - this.swipeStartAt;
    const isSwipe = Math.abs(deltaX) > 90 && Math.abs(deltaY) < 52 && elapsed < 700;

    if (!isSwipe) return;

    this.ngZone.run(() => this.selectAdjacentHeroModel(deltaX < 0 ? 1 : -1));
  }

  private loadHeroModel(scene: THREE.Scene, controls: OrbitControls): void {
    const selectedModel = this.activeHeroModel();
    const loadToken = ++this.modelLoadToken;

    this.clearCurrentModel();
    this.modelLoaded.set(false);
    this.modelLoadFailed.set(false);

    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/assets/draco/');
    dracoLoader.setDecoderConfig({ type: 'wasm' });
    loader.setDRACOLoader(dracoLoader);
    this.dracoLoader = dracoLoader;

    loader.load(
      selectedModel.url,
      (gltf) => {
        if (loadToken !== this.modelLoadToken) {
          this.disposeObject(gltf.scene);
          return;
        }

        const model = gltf.scene;
        this.prepareModel(model);
        const pivot = this.frameModel(model, controls);
        scene.add(pivot);
        this.model = pivot;
        this.ngZone.run(() => this.modelLoaded.set(true));
      },
      undefined,
      () => {
        if (loadToken === this.modelLoadToken) {
          this.ngZone.run(() => this.modelLoadFailed.set(true));
        }
      },
    );
  }

  private prepareModel(model: THREE.Object3D): void {
    this.leatherMaterials.length = 0;

    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;

      child.castShadow = true;
      child.receiveShadow = true;

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) {
          if (this.isLeatherMaterial(material)) {
            this.configureLeatherMaterial(material);
            this.leatherMaterials.push(material);
          } else {
            this.applyReferenceMaterialColor(material);
          }
        }

        material.needsUpdate = true;
      });
    });

    this.applyLeatherColor(this.selectedLeatherColor());
  }

  private configureLeatherMaterial(material: THREE.MeshStandardMaterial): void {
    material.metalness = 0;
    material.roughness = material.map ? 0.92 : 0.86;
    material.envMapIntensity = 0.18;

    if (material.normalMap) {
      material.normalScale.set(0.55, 0.55);
    }
  }

  private applyReferenceMaterialColor(material: THREE.MeshStandardMaterial): void {
    const materialName = material.name.trim().toLowerCase();

    if (materialName === 'material.001' || materialName.includes('inner_lining')) {
      material.color.set(this.referenceMaterialColors.footbed);
      material.metalness = 0;
      material.roughness = 0.95;
      material.envMapIntensity = 0.1;
      if (material.normalMap) material.normalScale.set(0.34, 0.34);
      return;
    }

    if (materialName.includes('stitch')) {
      material.color.set(this.referenceMaterialColors.stitch);
      material.metalness = 0;
      material.roughness = 0.97;
      material.envMapIntensity = 0.08;
      if (material.normalMap) material.normalScale.set(0.42, 0.42);
      return;
    }

    if (materialName.includes('backle') || materialName.includes('buckle') || materialName.includes('metal')) {
      material.color.set(this.referenceMaterialColors.buckle);
      material.metalness = 0.05;
      material.roughness = 0.68;
      material.envMapIntensity = 0.32;
      return;
    }

    if (materialName.includes('rubber')) {
      material.color.set(this.referenceMaterialColors.leatherDeep);
      material.metalness = 0;
      material.roughness = 0.88;
      material.envMapIntensity = 0.12;
      return;
    }

    material.metalness = 0;
    material.roughness = Math.max(material.roughness, 0.82);
    material.envMapIntensity = 0.18;
  }

  private isLeatherMaterial(material: THREE.MeshStandardMaterial): boolean {
    const materialName = material.name.trim().toLowerCase();

    return materialName === 'material' || materialName.includes('outer_leather') || materialName.includes('leather');
  }

  private frameModel(model: THREE.Object3D, controls: OrbitControls): THREE.Object3D {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxAxis = Math.max(size.x, size.y, size.z, 1);
    const hostWidth = this.heroCanvas?.nativeElement.parentElement?.clientWidth ?? 0;
    const isCompact = hostWidth < 560;
    const scale = (isCompact ? 5.15 : 6.65) / maxAxis;
    const yOffset = isCompact ? 0.08 : -0.34;
    const defaultYaw = -Math.PI / 2 + 0.34;
    const pivot = new THREE.Group();
    const centeredModel = new THREE.Group();

    model.position.set(-center.x, -center.y, -center.z);
    centeredModel.add(model);
    centeredModel.scale.setScalar(scale);
    centeredModel.position.y = yOffset;
    centeredModel.rotation.set(-0.11, 0, 0.025);
    pivot.add(centeredModel);
    pivot.rotation.y = defaultYaw;
    this.modelYaw = defaultYaw;

    controls.target.set(0, isCompact ? 0.16 : yOffset, 0);
    controls.update();

    return pivot;
  }

  private applyLeatherColor(id: string): void {
    const option = this.leatherColors.find((color) => color.id === id) ?? this.leatherColors[0];

    this.leatherMaterials.forEach((material) => {
      material.color.set(option.color);
      material.needsUpdate = true;
    });
  }

  private animateHero(): void {
    if (!this.renderer || !this.scene || !this.camera) return;

    this.animationFrame = window.requestAnimationFrame(() => this.animateHero());

    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  }

  private destroyHeroModel(): void {
    if (this.animationFrame) window.cancelAnimationFrame(this.animationFrame);
    this.heroCanvas?.nativeElement.removeEventListener('pointerdown', this.handleModelPointerDown);
    window.removeEventListener('pointermove', this.handleModelPointerMove);
    window.removeEventListener('pointerup', this.handleModelPointerUp);
    window.removeEventListener('pointercancel', this.handleModelPointerUp);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.dracoLoader?.dispose();
    this.environmentRenderTarget?.dispose();
    this.environmentRenderTarget = undefined;

    this.clearCurrentModel();
    if (this.scene) this.scene.environment = null;
    if (this.scene) this.disposeObject(this.scene);

    this.renderer?.dispose();
  }

  private clearCurrentModel(): void {
    if (!this.model) return;

    this.scene?.remove(this.model);
    this.disposeObject(this.model);
    this.model = undefined;
    this.leatherMaterials.length = 0;
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;

      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
  }
}
