import React, { useEffect, useState } from "react";
import { Map, MapMouseEvent, LngLat } from "maplibre-gl";
import { useLazyQuery } from "@apollo/client";
import { toast } from "react-hot-toast";
import SaveAltIcon from "@mui/icons-material/SaveAlt";
import {
  GET_POLYGONS_IN_BBOX,
  GET_NATURAL_POLYGONS_IN_BBOX,
} from "@/graphql/query/polygon";
import { GET_ROADS_OFFLINE } from "@/graphql/query/road";
import { GET_BASE_COASTLINES } from "@/graphql/query/coastline";
import { GET_BASE_COUNTRIES } from "@/graphql/query/country";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import { storeOfflineData } from "../utils/idbOfflineStorage";
import type { FeatureCollection, Polygon, GeoJsonProperties } from "geojson";
import { clear } from "console";
import HighlightAltIcon from "@mui/icons-material/HighlightAlt";
import { getDB } from "@/lib/db";


interface OfflineAreaDownloaderProps {
  map: Map | null;
}

async function saveFC(
  store:
    | "horizon_road_network"
    | "horizon_polygons"
    | "horizon_natural_polygons",
  fc: FeatureCollection | undefined
) {
  if (!fc?.features?.length || !fc.bbox) return;
  const db = await getDB();
  const [minLon, minLat, maxLon, maxLat] = fc.bbox as [
    number,
    number,
    number,
    number
  ];
  const tx = db.transaction(store, "readwrite");
  fc.features.forEach((f: any) => {
    if (typeof f?.properties?.id !== "number") {
      return;
    }
    tx.store.put({
      ...f,
      bbox: fc.bbox,
      minLon,
      minLat,
      maxLon,
      maxLat,
    });
  });
  await tx.done;
  console.log(`Saved ${fc.features.length} → ${store}`);
}

const OfflineAreaDownloader: React.FC<OfflineAreaDownloaderProps> = ({
  map,
}) => {
  const [isSelectingArea, setIsSelectingArea] = useState<boolean>(false);

  const [startCoord, setStartCoord] = useState<[number, number] | null>(null);
  const [endCoord, setEndCoord] = useState<[number, number] | null>(null);
  const maxDownloadSize = 10;

  const [fetchRoads] = useLazyQuery(GET_ROADS_OFFLINE);
  const [fetchPolygons] = useLazyQuery(GET_POLYGONS_IN_BBOX);

  const [fetchCoastlines] = useLazyQuery(GET_BASE_COASTLINES);
  const [fetchCountries] = useLazyQuery(GET_BASE_COUNTRIES);
  const [fetchNaturalPolygons] = useLazyQuery(GET_NATURAL_POLYGONS_IN_BBOX);

  useEffect(() => {
    if (!map) return;

    if (!isSelectingArea) {
      map.dragPan.enable();
      return;
    } else {
      map.dragPan.disable();
    }

    let isDragging = false;
    let startLngLat: [number, number] | null = null;

    function onMouseDown(e: MapMouseEvent & { type: "mousedown" }) {
      isDragging = true;
      startLngLat = [e.lngLat.lng, e.lngLat.lat];
      setStartCoord([e.lngLat.lng, e.lngLat.lat]);
    }

    function onMouseMove(e: MapMouseEvent & { type: "mousemove" }) {
      if (!isDragging || !startLngLat) return;

      const curr: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      updateRectangleOverlay(startLngLat, curr);
    }

    function onMouseUp(e: MapMouseEvent & { type: "mouseup" }) {
      if (!isDragging || !startLngLat) return;
      isDragging = false;

      const final: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      setEndCoord(final);
      updateRectangleOverlay(startLngLat, final);
    }

    map.on("mousedown", onMouseDown);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);

    return () => {
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);

      removeRectangleOverlay();
    };
  }, [map, isSelectingArea]);

  function updateRectangleOverlay(
    start: [number, number],
    end: [number, number]
  ) {
    if (!map) return;

    const minLon = Math.min(start[0], end[0]);
    const maxLon = Math.max(start[0], end[0]);
    const minLat = Math.min(start[1], end[1]);
    const maxLat = Math.max(start[1], end[1]);

    const coords: [number, number][] = [
      [minLon, minLat],
      [minLon, maxLat],
      [maxLon, maxLat],
      [maxLon, minLat],
      [minLon, minLat],
    ];

    const area = (maxLon - minLon) * (maxLat - minLat);
    let color = "#32cd32";
    let label = "";

    if (area > 0.3 && area <= 2) {
      color = "#ffcc00";
      label = "Ensure storage is available";
    } else if (area > 2 && area <= maxDownloadSize) {
      color = "#ff4500";
      label = "Warning: Require significant storage";
    } else if (area > maxDownloadSize) {
      color = "#808080";
      label = "Too large, please zoom in and select a smaller area";
    }

    const geojson: FeatureCollection<Polygon, GeoJsonProperties> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [coords],
          },
          properties: {
            color: color,
            label: label,
          },
        },
      ],
    };

    const sourceId = "boxSource";
    const layerId = "boxLayer";
    const layerOutlineId = "boxOutlineLayer";
    const layerLabelId = "boxLabelLayer";

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: "geojson",
        data: geojson,
      });

      map.addLayer({
        id: layerOutlineId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#999ea0"],
          "line-width": 2,
        },
      });

      map.addLayer({
        id: layerId,
        type: "fill",
        source: sourceId,
        paint: {
          "fill-color": ["coalesce", ["get", "color"], "#999ea0"],
          "fill-opacity": 0.2,
        },
      });

      map.addLayer({
        id: layerLabelId,
        type: "symbol",
        source: sourceId,
        layout: {
          "text-field": ["coalesce", ["get", "label"], "Drag to select area"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 0, 10, 24, 35],
          "text-anchor": "center",
          "text-padding": 5,
        },
        paint: {
          "text-color": "#000000",
        },
      });
    } else {
      const src = map.getSource(sourceId) as maplibregl.GeoJSONSource;
      src.setData(geojson);
    }
  }

  function removeRectangleOverlay() {
    if (!map) return;
    const sourceId = "boxSource";
    const layerId = "boxLayer";
    const layerOutlineId = "boxOutlineLayer";
    const layerLabelId = "boxLabelLayer";
    if (map.getLayer(layerOutlineId)) {
      map.removeLayer(layerOutlineId);
    }
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
    if (map.getLayer(layerLabelId)) {
      map.removeLayer(layerLabelId);
    }
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
  }

  function clearSelection() {
    setIsSelectingArea(false);
    setStartCoord(null);
    setEndCoord(null);
    removeRectangleOverlay();
  }

  async function handleDownload() {
    if (!startCoord || !endCoord) {
      toast.error("No bounding box selected");
      return;
    }

    const minLon = Math.min(startCoord[0], endCoord[0]);
    const maxLon = Math.max(startCoord[0], endCoord[0]);
    const minLat = Math.min(startCoord[1], endCoord[1]);
    const maxLat = Math.max(startCoord[1], endCoord[1]);

    const area = (maxLon - minLon) * (maxLat - minLat);
    if (area > maxDownloadSize) {
      toast.error("Too large for offline storage");
      return;
    }

    toast.loading("Downloading data for offline...");

    try {


      const naturalPolygonsRes = await fetchNaturalPolygons({
        variables: { minLon, minLat, maxLon, maxLat, limit: 999999 },
      });
      const roadsRes = await fetchRoads({
        variables: { minLon, minLat, maxLon, maxLat },
      });
      const polygonsRes = await fetchPolygons({
        variables: { minLon, minLat, maxLon, maxLat, limit: 999999 },
      });
      const offlineData = {
        horizon_road_network: roadsRes?.data?.roadsOffline?.features?.map(
          (feature: any) => feature?.properties?.id
        ),
        horizon_natural_polygons: naturalPolygonsRes?.data?.naturalPolygonsBbox?.features?.map(
          (feature: any) => feature?.properties?.id
        ),
        horizon_polygons: polygonsRes?.data?.polygonsBbox?.features?.map(
          (feature: any) => feature?.properties?.id
        ),
      };

      const boundingBoxKey = `${minLon},${minLat},${maxLon},${maxLat}`;
      await storeOfflineData(boundingBoxKey, offlineData);

      await saveFC("horizon_road_network", roadsRes.data.roadsOffline);

      await saveFC("horizon_polygons", polygonsRes.data.polygonsBbox);

      await saveFC(
        "horizon_natural_polygons",
        naturalPolygonsRes.data.naturalPolygonsBbox
      );

      toast.dismiss();
      toast.success("Data available offline");

      setIsSelectingArea(false);
      setStartCoord(null);
      setEndCoord(null);
      removeRectangleOverlay();
      window.location.reload();
    } catch (err) {
      console.error("Error fetching/storing offline data:", err);
      toast.dismiss();
      toast.error("Failed to download offline data");
    }
  }

  return (
    <div className="w-full">
      {!isSelectingArea && (
        <button
          onClick={() => {
            setIsSelectingArea(true);
            toast("Drag on map to select area", { icon: <HighlightAltIcon /> });
          }}
          className=" bg-emerald-600 hover:bg-emerald-700 text-sm text-white px-4 py-2 rounded-md flex flex-row items-center gap-2 transition-colors duration-200"
        >
          <AddIcon /> <span className=" min-w-max inline-block">Add Area</span>
        </button>
      )}

      {isSelectingArea && (
        <div className="flex flex-row items-center justify-between gap-2">
          <button
            onClick={clearSelection}
            className=" bg-red-600 hover:bg-red-700 text-sm text-white px-4 py-2 rounded-md flex flex-row items-center gap-2 transition-colors duration-200"
          >
            <CloseIcon />{" "}
            <span className=" min-w-max inline-block">Cancel</span>
          </button>
          {startCoord && endCoord && (
            <div className="flex flex-col gap-2">
              <button
                onClick={handleDownload}
                className=" bg-emerald-600 hover:bg-emerald-700 text-sm text-white px-4 py-2 rounded-md flex flex-row items-center gap-2 transition-colors duration-200"
              >
                <SaveAltIcon />{" "}
                <span className=" min-w-max inline-block">Save</span>
              </button>
            </div>
          )}
        </div>
      )}

    
    </div>
  );
};

export default OfflineAreaDownloader;
