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
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ProductsService } from '../../services/products.service';
import { Product } from '../../models/product.model';

interface MetaCard {
  id: number;
  label: string;
  sub: string;
  icon: string;
}

interface PromiseStat {
  value: string;
  label: string;
}

interface LeatherColorOption {
  id: string;
  name: string;
  color: number;
  swatch: string;
}

interface HeroModelOption {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  subtitle: string;
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
  private readonly products = inject(ProductsService);
  private readonly router = inject(Router);
  private readonly ngZone = inject(NgZone);

  private metaTimer: number | undefined;
  private resizeObserver?: ResizeObserver;
  private animationFrame = 0;
  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private controls?: OrbitControls;
  private dracoLoader?: DRACOLoader;
  private model?: THREE.Object3D;
  private modelYaw = 0;
  private isDraggingModel = false;
  private lastPointerX = 0;
  private modelLoadToken = 0;
  private scrollFrame = 0;
  private readonly handleModelPointerDown = (event: PointerEvent): void => this.onModelPointerDown(event);
  private readonly handleModelPointerMove = (event: PointerEvent): void => this.onModelPointerMove(event);
  private readonly handleModelPointerUp = (event: PointerEvent): void => this.onModelPointerUp(event);
  private readonly handleScroll = (): void => this.queueHeroScroll();
  private readonly leatherMaterials: THREE.MeshStandardMaterial[] = [];

  @ViewChild('heroSection') private heroSection?: ElementRef<HTMLElement>;
  @ViewChild('heroCanvas') private heroCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('heroShell') private heroShell?: ElementRef<HTMLElement>;
  @ViewChild('heroVisual') private heroVisual?: ElementRef<HTMLElement>;

  readonly metaVisible = signal(false);
  readonly modelLoaded = signal(false);
  readonly modelLoadFailed = signal(false);
  readonly selectedModelId = signal('heritage-mule');
  readonly selectedLeatherColor = signal('cognac');
  readonly featured: Product[] = this.products.getFeatured();

  readonly heroModels: HeroModelOption[] = [
    {
      id: 'heritage-mule',
      index: '01',
      eyebrow: 'Heritage Series',
      title: 'Doha Mule',
      subtitle: 'A sculpted leather silhouette with hand-finished stitch detail.',
      url: '/assets/models/latest-brown-v2.glb',
    },
    {
      id: 'majlis-slide',
      index: '02',
      eyebrow: 'Majlis Edition',
      title: 'Majlis Slide',
      subtitle: 'A refined open form designed for warm evenings and private settings.',
      url: '/assets/models/latest-brown-v2.glb',
    },
    {
      id: 'atelier-form',
      index: '03',
      eyebrow: 'Atelier Form',
      title: 'Nomad Sandal',
      subtitle: 'A modern Arabic profile prepared for the next crafted model release.',
      url: '/assets/models/latest-brown-v2.glb',
    },
  ];

  readonly activeHeroModel = computed(
    () => this.heroModels.find((model) => model.id === this.selectedModelId()) ?? this.heroModels[0],
  );

  readonly leatherColors: LeatherColorOption[] = [
    { id: 'cognac', name: 'Cognac', color: 0x7b4b2b, swatch: '#7b4b2b' },
    { id: 'espresso', name: 'Espresso', color: 0x2e1b12, swatch: '#2e1b12' },
    { id: 'sand', name: 'Sand', color: 0xb98d54, swatch: '#b98d54' },
  ];

  readonly metaCards: MetaCard[] = [
    { id: 1, label: 'Hand-stitched Detail', sub: 'Triple-lock welt seam', icon: '◊' },
    { id: 2, label: 'Premium Camel Leather', sub: 'Full-grain, Doha tannery', icon: '◆' },
    { id: 3, label: '48hr Crafting Time', sub: 'Single artisan, zero compromise', icon: '◈' },
  ];

  readonly stats: PromiseStat[] = [
    { value: '60+', label: 'Years of Heritage' },
    { value: '12',  label: 'Master Artisans' },
    { value: '48hr', label: 'Per Pair' },
    { value: '∞',   label: 'Lifetime Care' },
  ];

  ngOnInit(): void {
    this.metaTimer = window.setTimeout(() => this.metaVisible.set(true), 1800);
  }

  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => this.initHeroModel());
  }

  ngOnDestroy(): void {
    if (this.metaTimer) clearTimeout(this.metaTimer);
    this.destroyHeroModel();
  }

  goToProduct(p: Product): void {
    void this.router.navigate(['/product', p.id]);
    window.scrollTo(0, 0);
  }

  goTo(path: string): void {
    void this.router.navigate([path]);
    window.scrollTo(0, 0);
  }

  onImgError(e: Event): void {
    (e.target as HTMLImageElement).style.display = 'none';
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
    renderer.toneMappingExposure = 1.12;
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
    this.addHeroGround(scene);
    this.bindHeroResize(host);
    this.bindHeroScroll();
    this.bindModelDrag(canvas);
    this.loadHeroModel(scene, controls);
    this.animateHero();
  }

  private addHeroLighting(scene: THREE.Scene): void {
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8c3a2, 1.65));

    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(3.8, 5.8, 4.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 18;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xf4dfb7, 1.25);
    fillLight.position.set(-4.2, 2.4, 2.2);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 1.9);
    rimLight.position.set(-2.6, 3.8, -3.8);
    scene.add(rimLight);
  }

  private addHeroGround(scene: THREE.Scene): void {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(2.85, 96),
      new THREE.ShadowMaterial({ color: 0x6c5230, opacity: 0.16 }),
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
    const canvas = this.heroCanvas?.nativeElement;
    if (canvas?.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  private bindHeroScroll(): void {
    window.addEventListener('scroll', this.handleScroll, { passive: true });
    window.addEventListener('resize', this.handleScroll, { passive: true });
    this.queueHeroScroll();
  }

  private queueHeroScroll(): void {
    if (this.scrollFrame) return;

    this.scrollFrame = window.requestAnimationFrame(() => {
      this.scrollFrame = 0;
      const hero = this.heroSection?.nativeElement;
      const shell = this.heroShell?.nativeElement;
      const visual = this.heroVisual?.nativeElement;
      if (!hero || !shell || !visual) return;

      const viewport = Math.max(window.innerHeight, 1);
      const width = Math.max(window.innerWidth, 1);
      const heroTop = hero.getBoundingClientRect().top + window.scrollY;
      const scrollDistance = Math.max(hero.offsetHeight - viewport, viewport * 0.72);
      const progress = Math.min(Math.max((window.scrollY - heroTop) / scrollDistance, 0), 1);
      const maxShift = width <= 560
        ? Math.min(width * 0.12, 54)
        : width <= 920
          ? Math.min(width * 0.22, 180)
          : Math.min(width * 0.28, 360);
      const shiftY = viewport * 0.04 * progress;
      const scale = 1 - progress * 0.06;

      const scrollProperties = {
        '--hero-scroll-progress': progress.toFixed(4),
        '--hero-shift-x': `${(maxShift * progress).toFixed(2)}px`,
        '--hero-shift-y': `${shiftY.toFixed(2)}px`,
        '--hero-scale': scale.toFixed(4),
      };

      Object.entries(scrollProperties).forEach(([property, value]) => {
        shell.style.setProperty(property, value);
        visual.style.setProperty(property, value);
      });
    });
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
        if (material instanceof THREE.MeshStandardMaterial && !material.map) {
          if (material.name === 'Material') {
            this.leatherMaterials.push(material);
          } else if (material.name === 'Material.001') {
            material.color.set(0xc8b897);
          }
          material.metalness = 0;
          material.roughness = Math.max(material.roughness, 0.72);
        }

        material.needsUpdate = true;
        if ('envMapIntensity' in material) {
          material.envMapIntensity = 0.8;
        }
      });
    });

    this.applyLeatherColor(this.selectedLeatherColor());
  }

  private frameModel(model: THREE.Object3D, controls: OrbitControls): THREE.Object3D {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxAxis = Math.max(size.x, size.y, size.z, 1);
    const hostWidth = this.heroCanvas?.nativeElement.parentElement?.clientWidth ?? 0;
    const isCompact = hostWidth < 560;
    const scale = (isCompact ? 3.85 : 6.65) / maxAxis;
    const yOffset = isCompact ? -0.18 : -0.34;
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

    controls.target.set(0, yOffset, 0);
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
    if (this.scrollFrame) window.cancelAnimationFrame(this.scrollFrame);
    window.removeEventListener('scroll', this.handleScroll);
    window.removeEventListener('resize', this.handleScroll);
    this.heroCanvas?.nativeElement.removeEventListener('pointerdown', this.handleModelPointerDown);
    window.removeEventListener('pointermove', this.handleModelPointerMove);
    window.removeEventListener('pointerup', this.handleModelPointerUp);
    window.removeEventListener('pointercancel', this.handleModelPointerUp);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.dracoLoader?.dispose();

    this.clearCurrentModel();
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
