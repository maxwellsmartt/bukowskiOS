export const ipcChannels = {
  app: {
    getInfo: "bukowskiApp:getInfo",
  },
  shell: {
    getBootstrap: "bukowskiShell:getBootstrap",
  },
  overview: {
    getSnapshot: "bukowskiOverview:getSnapshot",
  },
  assets: {
    getList: "bukowskiAssets:getList",
    getDetail: "bukowskiAssets:getDetail",
    assignMove: "bukowskiAssets:assignMove",
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
  },
  finance: {
    getOverview: "bukowskiFinance:getOverview",
    getCostLinks: "bukowskiFinance:getCostLinks",
    getEntries: "bukowskiFinance:getEntries",
  },
} as const;
