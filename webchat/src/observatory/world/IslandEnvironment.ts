import * as THREE from "three";
import {
  createBillboards,
  createFarBuildings,
  createFillBuildings,
  createGround,
  createGroundFog,
  createParticles,
  createRoads,
  createStarfield,
  createStreetGrid,
  createZoneBeams,
  createZoneBuildings,
} from "./island-environment/builders";
import type {
  ParticleData,
  RoadEndpoint,
  RoadParticle,
  TwinkleStar,
} from "./island-environment/types";
import {
  updateAtmosphericParticles,
  updateBillboards,
  updateRoadFlowParticles,
  updateShaderMaterials,
  updateStarfield,
} from "./island-environment/update";

export class IslandEnvironment {
  private shaderMaterials: THREE.ShaderMaterial[] = [];
  private starData: TwinkleStar[] = [];
  private starGeometry!: THREE.BufferGeometry;
  private particleData: ParticleData[] = [];
  private particleGeometry!: THREE.BufferGeometry;
  private billboards: THREE.Mesh[] = [];
  private roadParticleGeo!: THREE.BufferGeometry;
  private roadParticles: RoadParticle[] = [];
  private roadEndpoints: RoadEndpoint[] = [];

  constructor(scene: THREE.Scene) {
    createGround(scene);
    createStreetGrid(scene);
    createZoneBuildings(scene);
    createFillBuildings(scene);
    createFarBuildings(scene);
    createZoneBeams(scene);

    const roads = createRoads(scene);
    this.roadParticleGeo = roads.roadParticleGeo;
    this.roadParticles = roads.roadParticles;
    this.roadEndpoints = roads.roadEndpoints;

    const stars = createStarfield(scene);
    this.starData = stars.data;
    this.starGeometry = stars.geometry;

    const particles = createParticles(scene);
    this.particleData = particles.data;
    this.particleGeometry = particles.geometry;

    this.billboards = createBillboards(scene);
    this.shaderMaterials.push(createGroundFog(scene));
  }

  update(time: number) {
    updateShaderMaterials(time, this.shaderMaterials);
    updateStarfield(time, this.starGeometry, this.starData);
    updateAtmosphericParticles(time, this.particleGeometry, this.particleData);
    updateRoadFlowParticles(
      this.roadParticleGeo,
      this.roadParticles,
      this.roadEndpoints,
    );
    updateBillboards(this.billboards);
  }
}
