import { useEffect, useRef, useState } from "react";
import maplibregl, { Map } from "maplibre-gl";
import Controls from "./components/controls";
import Amenities from "./components/amenities";
import SearchBar from "./components/searchBar";
import Menu from "./components/menu";
import Loader from "./components/loader";
import { useLazyQuery } from "@apollo/client";
import {
  GET_POLYGONS_IN_BBOX,
  GET_NATURAL_POLYGONS_IN_BBOX,
} from "@/graphql/query/polygon";
import { GET_ROADS_IN_BBOX } from "@/graphql/query/road";
import { GET_BASE_COASTLINES } from "@/graphql/query/coastline";
import { GET_BASE_COUNTRIES } from "@/graphql/query/country";
import { GET_BASE_STATES } from "@/graphql/query/states";
import {
  initializeMapSourcesAndLayers,
  updatePolygons,
  updateNaturalPolygons,
  updateBaseStates,
  updateRoads,
  resetBoundingBoxes,
} from "./utils/mapUtils";
import {
  transformCountryLabels,
  transformStatesLabelsData,
  transformUserLocation,
} from "./utils/geoUtils";
import { extrudedBuildingsLayer } from "./layers/polygon";
import ScaleBar from "./components/scalebar";
import { toast } from "react-hot-toast";
import Image from "next/image";
import Account from "./components/account";
import InfoPopup from "./components/ui/infoPopup";
import { getDB } from "@/lib/db";

export default function MapView() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const lastCenterRef = useRef<{ lng: number; lat: number } | null>(null);

  const [
    fetchCoastlines,
    {
      data: baseCoastlinesData,
      loading: baseCoastlinesLoading,
      error: baseCoastlinesError,
    },
  ] = useLazyQuery(GET_BASE_COASTLINES);

  const [
    fetchCountries,
    {
      data: baseCountriesData,
      loading: baseCountriesLoading,
      error: baseCountriesError,
    },
  ] = useLazyQuery(GET_BASE_COUNTRIES);

  const [
    fetchStates,
    {
      data: baseStatesData,
      loading: baseStatesLoading,
      error: baseStatesError,
    },
  ] = useLazyQuery(GET_BASE_STATES);

  const [
    fetchPolygons,
    { data: polygonsData, loading: polygonsLoading, error: polygonsError },
  ] = useLazyQuery(GET_POLYGONS_IN_BBOX);

  const [
    fetchNaturalPolygons,
    {
      data: naturalPolygonsData,
      loading: naturalPolygonsLoading,
      error: naturalPolygonsError,
    },
  ] = useLazyQuery(GET_NATURAL_POLYGONS_IN_BBOX);

  const [
    fetchRoads,
    { data: roadsData, loading: roadsLoading, error: roadsError },
  ] = useLazyQuery(GET_ROADS_IN_BBOX);

  useEffect(() => {
    if (map || !mapContainerRef.current) return;
    const mapInstance = new maplibregl.Map({
      container: mapContainerRef.current,
      center: [114.164607345042695, 22.322817387691138],
      zoom: 15.7,
      pitch: 35,
      minZoom: 0,
      style: {
        version: 8,
        name: "VectorGL",
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf", //online font-library for labels font
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#89cee0" },
          },
        ],
      },
      dragRotate: false,
      pitchWithRotate: false,
    });

    const size = 100;
    const pulsingDot = {
      width: size,
      height: size,
      context: null as CanvasRenderingContext2D | null,
      data: new Uint8Array(size * size * 4),

      onAdd() {
        const canvas = document.createElement("canvas");
        canvas.width = this.width;
        canvas.height = this.height;
        this.context = canvas.getContext("2d");
      },

      render() {
        const duration = 1000;
        const t = (performance.now() % duration) / duration;

        const radius = (size / 2) * 0.3;
        const outerRadius = (size / 2) * 0.7 * t + radius;
        const context = this.context;
        if (!context) return false;

        context.clearRect(0, 0, this.width, this.height);
        context.beginPath();
        context.arc(
          this.width / 2,
          this.height / 2,
          outerRadius,
          0,
          Math.PI * 2
        );
        context.fillStyle = `rgba(200, 200, 255,${1 - t})`;
        context.fill();

        context.beginPath();
        context.arc(this.width / 2, this.height / 2, radius, 0, Math.PI * 2);
        context.fillStyle = "rgba(100, 100, 255, 1)";
        context.strokeStyle = "white";
        context.lineWidth = 2 + 4 * (1 - t);
        context.fill();
        context.stroke();

        this.data = new Uint8Array(
          context.getImageData(0, 0, this.width, this.height).data
            .buffer as ArrayBuffer
        );

        mapInstance.triggerRepaint();

        return true;
      },
    };

    mapInstance.once("load", () => {
      initializeMapSourcesAndLayers(mapInstance);
      mapInstance.addImage("pulsing-dot", pulsingDot, { pixelRatio: 2 });

      if (!mapInstance.getLayer(extrudedBuildingsLayer.layer.id)) {
        mapInstance.addLayer(extrudedBuildingsLayer.layer);
      }

      const baseCoastlineLayer = mapInstance.getLayer("baseCoastlineLayer");
      const baseCountriesLayer = mapInstance.getLayer("baseCountriesLayer");
      const baseStatesLayer = mapInstance.getLayer("baseStatesLayer");
      const polygonsLayer = mapInstance.getLayer("basePolygonsLayer");
      const naturalPolygonsLayer = mapInstance.getLayer("naturalPolygonsLayer");
      const roadLayer = mapInstance.getLayer("roadLayer");

      const zoom = mapInstance.getZoom();
      const center = mapInstance.getCenter();

      if (baseCoastlineLayer) {
        getDB()
          .then((db) => db.getAll("natural_earth_coastline"))
          .then((allCoastlines) => {
            if (allCoastlines.length > 0) {
              console.log("Using coastlines from IndexedDB");
              const coastlinesData = {
                type: "FeatureCollection" as const,
                features: allCoastlines,
              };
              const source = mapInstance.getSource(
                "localBaseCoastlines"
              ) as maplibregl.GeoJSONSource;
              if (source) {
                source.setData(coastlinesData);
              }
            } else {
              console.log("No coastlines in IndexedDB, fetching from API");
              fetchCoastlines().catch((err: any) =>
                console.error("fetchCoastlines error:", err)
              );
            }
          })
          .catch((error) => {
            console.error("Error retrieving coastlines from IndexedDB:", error);
            fetchCoastlines().catch((err: any) =>
              console.error("fetchCoastlines error:", err)
            );
          });
      } else {
        console.log("baseCoastlineLayer is hidden");
      }

      if (baseCountriesLayer) {
        getDB()
          .then((db) => db.getAll("natural_earth_country"))
          .then((allCountries) => {
            if (allCountries.length > 0) {
              console.log("Using countries from IndexedDB");
              const countriesData = {
                type: "FeatureCollection" as const,
                features: allCountries,
              };
              const polygonSource = mapInstance.getSource(
                "localBaseCountries"
              ) as maplibregl.GeoJSONSource;
              if (polygonSource) {
                polygonSource.setData(countriesData);
              }

              // Also handle country labels
              const labelGeoJSON = transformCountryLabels({
                countries: countriesData,
              });
              const labelSource = mapInstance.getSource(
                "localBaseCountryLabels"
              ) as maplibregl.GeoJSONSource;
              if (labelSource) {
                labelSource.setData(labelGeoJSON);
              }
            } else {
              console.log("No countries in IndexedDB, fetching from API");
              fetchCountries().catch((err: any) =>
                console.error("fetchCountries error:", err)
              );
            }
          })
          .catch((error) => {
            console.error("Error retrieving countries from IndexedDB:", error);
            fetchCountries().catch((err: any) =>
              console.error("fetchCountries error:", err)
            );
          });
      } else {
        console.log("baseCountriesLayer is hidden");
      }

      // Check if we've moved to a completely new area (not just zoomed in)
      if (lastCenterRef.current) {
        const lastCenter = lastCenterRef.current;
        // If we've moved more than 0.5 degrees in any direction, consider it a new area
        const hasMovedSignificantly =
          Math.abs(center.lng - lastCenter.lng) > 0.5 ||
          Math.abs(center.lat - lastCenter.lat) > 0.5;

        if (hasMovedSignificantly) {
          resetBoundingBoxes();
        }
      }

      // Update the last center reference
      lastCenterRef.current = { lng: center.lng, lat: center.lat };

      if (baseStatesLayer && !baseStatesLoading) {
        updateBaseStates(mapInstance, fetchStates, zoom);
        console.log("baseStatesLayer is visible");
      } else {
        console.log("baseStatesLayer is hidden");
      }

      if (
        naturalPolygonsLayer &&
        naturalPolygonsLayer.minzoom <= zoom &&
        zoom <= naturalPolygonsLayer.maxzoom &&
        !naturalPolygonsLoading
      ) {
        updateNaturalPolygons(mapInstance, fetchNaturalPolygons, 250);
        console.log("naturalPolygonsLayer is visible");
      } else {
        console.log("naturalPolygonsLayer is hidden");
      }

      if (
        polygonsLayer &&
        polygonsLayer.minzoom <= zoom &&
        zoom <= polygonsLayer.maxzoom &&
        !polygonsLoading
      ) {
        updatePolygons(mapInstance, fetchPolygons, 3000);
        console.log("polygonsLayer is visible");
      } else {
        console.log("polygonsLayer is hidden");
      }

      if (
        roadLayer &&
        roadLayer.minzoom <= zoom &&
        zoom <= roadLayer.maxzoom &&
        !roadsLoading
      ) {
        updateRoads(mapInstance, fetchRoads, zoom);
        console.log("roadLayer is visible");
      } else {
        console.log("roadLayer is hidden");
      }
    });

    mapInstance.on("moveend", () => {
      const baseStatesLayer = mapInstance.getLayer("baseStatesLayer");
      const polygonsLayer = mapInstance.getLayer("basePolygonsLayer");
      const naturalPolygonsLayer = mapInstance.getLayer("naturalPolygonsLayer");
      const roadLayer = mapInstance.getLayer("roadLayer");

      const zoom = mapInstance.getZoom();
      const center = mapInstance.getCenter();

      // Check if we've moved to a completely new area (not just zoomed in)
      if (lastCenterRef.current) {
        const lastCenter = lastCenterRef.current;
        // If we've moved more than 0.5 degrees in any direction, consider it a new area
        const hasMovedSignificantly =
          Math.abs(center.lng - lastCenter.lng) > 0.5 ||
          Math.abs(center.lat - lastCenter.lat) > 0.5;

        if (hasMovedSignificantly) {
          resetBoundingBoxes();
        }
      }

      // Update the last center reference
      lastCenterRef.current = { lng: center.lng, lat: center.lat };

      if (baseStatesLayer && !baseStatesLoading) {
        updateBaseStates(mapInstance, fetchStates, zoom);
        console.log("baseStatesLayer is visible");
      } else {
        console.log("baseStatesLayer is hidden");
      }

      if (
        naturalPolygonsLayer &&
        naturalPolygonsLayer.minzoom <= zoom &&
        zoom <= naturalPolygonsLayer.maxzoom &&
        !naturalPolygonsLoading
      ) {
        updateNaturalPolygons(mapInstance, fetchNaturalPolygons, 250);
        console.log("naturalPolygonsLayer is visible");
      } else {
        console.log("naturalPolygonsLayer is hidden");
      }

      if (
        polygonsLayer &&
        polygonsLayer.minzoom <= zoom &&
        zoom <= polygonsLayer.maxzoom &&
        !polygonsLoading
      ) {
        updatePolygons(mapInstance, fetchPolygons, 3000);
        console.log("polygonsLayer is visible");
      } else {
        console.log("polygonsLayer is hidden");
      }

      if (
        roadLayer &&
        roadLayer.minzoom <= zoom &&
        zoom <= roadLayer.maxzoom &&
        !roadsLoading
      ) {
        updateRoads(mapInstance, fetchRoads, zoom);
        console.log("roadLayer is visible");
      } else {
        console.log("roadLayer is hidden");
      }
    });

    setMap(mapInstance);
  }, []);

  useEffect(() => {
    if (baseCoastlinesData && map) {
      const source = map.getSource(
        "localBaseCoastlines"
      ) as maplibregl.GeoJSONSource;
      if (source) {
        source.setData(baseCoastlinesData.coastlines);

        // Store in IndexedDB for future use
        const coastFC = baseCoastlinesData.coastlines;
        if (coastFC?.features?.length && coastFC.bbox) {
          getDB()
            .then((db) => {
              const bboxArr = coastFC.bbox as [number, number, number, number];
              const [minLon, minLat, maxLon, maxLat] = bboxArr;
              const tx = db.transaction("natural_earth_coastline", "readwrite");
              coastFC.features.forEach((f: any) => {
                tx.store.put({
                  ...f,
                  bbox: bboxArr,
                  minLon,
                  minLat,
                  maxLon,
                  maxLat,
                });
              });
              return tx.done;
            })
            .then(() => {
              console.log(
                `Stored ${coastFC.features.length} coastlines in IndexedDB`
              );
            })
            .catch((error) => {
              console.error("Error storing coastlines in IndexedDB:", error);
            });
        }
      } else {
        console.error("Source 'localBaseCoastlines' not found");
      }
    }
  }, [baseCoastlinesData, map]);

  useEffect(() => {
    if (baseCountriesData && map) {
      const polygonSource = map.getSource(
        "localBaseCountries"
      ) as maplibregl.GeoJSONSource;
      if (polygonSource) {
        polygonSource.setData(baseCountriesData.countries);

        // Store in IndexedDB for future use
        const countryFC = baseCountriesData.countries;
        if (countryFC?.features?.length && countryFC.bbox) {
          getDB()
            .then((db) => {
              const bboxArr = countryFC.bbox as [
                number,
                number,
                number,
                number
              ];
              const [minLon, minLat, maxLon, maxLat] = bboxArr;
              const tx = db.transaction("natural_earth_country", "readwrite");
              countryFC.features.forEach((f: any) => {
                tx.store.put({
                  ...f,
                  bbox: bboxArr,
                  minLon,
                  minLat,
                  maxLon,
                  maxLat,
                });
              });
              return tx.done;
            })
            .then(() => {
              console.log(
                `Stored ${countryFC.features.length} countries in IndexedDB`
              );
            })
            .catch((error) => {
              console.error("Error storing countries in IndexedDB:", error);
            });
        }
      } else {
        console.error("Source 'localBaseCountries' not found");
      }

      const labelGeoJSON = transformCountryLabels(baseCountriesData);
      const labelSource = map.getSource(
        "localBaseCountryLabels"
      ) as maplibregl.GeoJSONSource;
      if (labelSource) {
        labelSource.setData(labelGeoJSON);
      } else {
        console.error("Source 'localBaseCountryLabels' not found");
      }
    }
  }, [baseCountriesData, map]);

  useEffect(() => {
    if (baseStatesData && map) {
      const source = map.getSource(
        "localBaseStates"
      ) as maplibregl.GeoJSONSource;
      if (source) {
        source.setData(baseStatesData.statesBbox);
      } else {
        console.error("Source 'localBaseStates' not found");
      }

      const labelGeoJSON = transformStatesLabelsData(baseStatesData);
      const labelSource = map.getSource(
        "localBaseStatesLabels"
      ) as maplibregl.GeoJSONSource;
      if (labelSource) {
        labelSource.setData(labelGeoJSON);
      } else {
        console.error("Source 'localBaseStateLabels' not found");
      }
    }
  }, [baseStatesData, map]);

  useEffect(() => {
    if (polygonsData && map) {
      const source = map.getSource(
        "localBasePolygons"
      ) as maplibregl.GeoJSONSource;
      if (source) {
        source.setData(polygonsData.polygonsBbox);
      } else {
        console.error("Source 'localPolygons' not found");
      }
    }
  }, [polygonsData, map]);

  useEffect(() => {
    if (naturalPolygonsData && map) {
      const source = map.getSource(
        "localBaseNaturalPolygons"
      ) as maplibregl.GeoJSONSource;
      if (source) {
        source.setData(naturalPolygonsData.naturalPolygonsBbox);
      } else {
        console.error("Source 'localNaturalPolygons' not found");
      }
    }
  }, [naturalPolygonsData, map]);

  useEffect(() => {
    if (roadsData && map) {
      const source = map.getSource("localRoads") as maplibregl.GeoJSONSource;
      if (source) {
        source.setData(roadsData.roadsBbox);
      } else {
        console.error("Source 'localRoads' not found");
      }
    }
  }, [roadsData, map]);

  useEffect(() => {
    if (polygonsError) {
      console.error("GraphQL small polygons query error:", polygonsError);
    }
    if (naturalPolygonsError) {
      console.error(
        "GraphQL small polygons query error:",
        naturalPolygonsError
      );
    }
    if (roadsError) {
      console.error("GraphQL roads query error:", roadsError);
    }

    if (baseCoastlinesError) {
      console.error(
        "GraphQL base coastlines query error:",
        baseCoastlinesError
      );
    }
    if (baseCountriesError) {
      console.error("GraphQL base countries query error:", baseCountriesError);
    }
    if (baseStatesError) {
      console.error("GraphQL base states query error:", baseStatesError);
    }
  }, [
    polygonsError,
    naturalPolygonsError,
    roadsError,
    baseCoastlinesError,
    baseCountriesError,
    baseStatesError,
  ]);

  const [userLocation, setUserLocation] = useState<maplibregl.LngLat | null>(
    null
  );

  useEffect(() => {
    if (!map || !navigator.geolocation) return;

    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by this browser.");
    }
    navigator.geolocation.getCurrentPosition(
      () => {},
      ({ code }) => {
        if (code === 1) {
          toast.error("Location Permission Denied");
          return;
        }
      }
    );

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setUserLocation(new maplibregl.LngLat(longitude, latitude));
        const geojson = transformUserLocation(longitude, latitude, accuracy);
        const src = map.getSource(
          "localUserLocation"
        ) as maplibregl.GeoJSONSource;
        if (src) src.setData(geojson);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          console.error("Location permission denied by user");
        } else {
          console.error("Geolocation error", err);
        }
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [map]);

  return (
    <>
      <div ref={mapContainerRef} style={{ width: "100%", height: "100vh" }} />
      {map && <InfoPopup map={map} />}
      {map && <Controls map={map} userLocation={userLocation} />}
      <div className="z-10 absolute  top-0 left-0 px-6 pt-6 flex gap-4 w-full items-start ">
        <div className="bg-white shadow-md flex items-center justify-center rounded-full min-w-10 min-h-10 transition-all hover:scale-110 duration-100">
          <Image
            src={"/logo/icon.png"}
            alt="Logo"
            width={30}
            height={30}
            className=" saturate-150 brightness-75 "
          />
        </div>
        {map && <SearchBar map={map} />}
        {map && <Amenities map={map} />}
        <Account />
      </div>
      {map && <Menu map={map} />}
      {map && (
        <Loader
          isLoading={
            polygonsLoading ||
            roadsLoading ||
            baseCoastlinesLoading ||
            baseCountriesLoading ||
            baseStatesLoading ||
            naturalPolygonsLoading
          }
        />
      )}
      {map && <ScaleBar map={map} />}
    </>
  );
}
