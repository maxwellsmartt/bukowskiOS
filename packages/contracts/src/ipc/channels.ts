export const ipcChannels = {
  app: {
    getInfo: "bukowskiApp:getInfo",
  },
  shell: {
    getBootstrap: "bukowskiShell:getBootstrap",
    searchGlobal: "bukowskiShell:searchGlobal",
  },
  overview: {
    getSnapshot: "bukowskiOverview:getSnapshot",
    getTimeline: "bukowskiOverview:getTimeline",
  },
  assets: {
    getList: "bukowskiAssets:getList",
    getDetail: "bukowskiAssets:getDetail",
    assignMove: "bukowskiAssets:assignMove",
    create: "bukowskiAssets:create",
    update: "bukowskiAssets:update",
    archive: "bukowskiAssets:archive",
  },
  packing: {
    getList: "bukowskiPacking:getList",
    getDetail: "bukowskiPacking:getDetail",
    create: "bukowskiPacking:create",
    returnItems: "bukowskiPacking:returnItems",
  },
  incidents: {
    getList: "bukowskiIncidents:getList",
    report: "bukowskiIncidents:report",
  },
  projects: {
    getList: "bukowskiProjects:getList",
    getDetail: "bukowskiProjects:getDetail",
    getCatalog: "bukowskiProjects:getCatalog",
    create: "bukowskiProjects:create",
    update: "bukowskiProjects:update",
    delete: "bukowskiProjects:delete",
    createUnit: "bukowskiProjects:createUnit",
    updateUnit: "bukowskiProjects:updateUnit",
    deleteUnit: "bukowskiProjects:deleteUnit",
    assignCrewToUnit: "bukowskiProjects:assignCrewToUnit",
    unassignCrewFromUnit: "bukowskiProjects:unassignCrewFromUnit",
  },
  catalog: {
    getSnapshot: "bukowskiCatalog:getSnapshot",
    create: "bukowskiCatalog:create",
    update: "bukowskiCatalog:update",
    delete: "bukowskiCatalog:delete",
  },
  finance: {
    getOverview: "bukowskiFinance:getOverview",
    getCostLinks: "bukowskiFinance:getCostLinks",
    getEntries: "bukowskiFinance:getEntries",
  },
} as const;
