import * as THREE from "three";
import { loadCityData, type CityData } from "./geo/osm-loader";
import { createBuildingMeshes, type BuildingChunkMesh } from "./geo/building-mesh";
import { createRoadMeshes } from "./geo/road-mesh";
import { createWaterMeshes } from "./geo/water-shader";

export class CityEnvironment {
  private scene: THREE.Scene;
  private buildingChunks: BuildingChunkMesh[] = [];
  private waterMaterials: THREE.ShaderMaterial[] = [];
  private ground: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  async load(url: string): Promise<void> {
    const data: CityData = await loadCityData(url);

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(
      data.bounds.maxX - data.bounds.minX + 100,
      data.bounds.maxZ - data.bounds.minZ + 100,
    );
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x020817,
      roughness: 0.95,
      metalness: 0.05,
    });
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.position.set(
      (data.bounds.minX + data.bounds.maxX) / 2,
      -0.01,
      (data.bounds.minZ + data.bounds.maxZ) / 2,
    );
    this.scene.add(this.ground);

    // Buildings
    this.buildingChunks = createBuildingMeshes(data.buildings.chunks);
    for (const chunk of this.buildingChunks) {
      this.scene.add(chunk.mesh);
    }

    // Roads
    createRoadMeshes(data.roads, this.scene);

    // Water
    this.waterMaterials = createWaterMeshes(data.water, this.scene);
  }

  update(elapsed: number, _delta: number): void {
    for (const mat of this.waterMaterials) {
      mat.uniforms.uTime.value = elapsed;
    }
  }

  dispose(): void {
    if (this.ground) {
      this.ground.geometry.dispose();
      (this.ground.material as THREE.Material).dispose();
      this.scene.remove(this.ground);
    }
    for (const chunk of this.buildingChunks) {
      chunk.mesh.geometry.dispose();
      (chunk.mesh.material as THREE.Material).dispose();
      this.scene.remove(chunk.mesh);
    }
  }
}
