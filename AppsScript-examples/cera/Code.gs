function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Chrome Enterprise Insider Risks Report')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Ping backend to check API connection (Fetches 1 item for speed)
 */
function discoveryCheck(timeRange) {
  try {
    let startTime = new Date();
    if (timeRange === '7d') startTime.setDate(startTime.getDate() - 7);
    else if (timeRange === '30d') startTime.setDate(startTime.getDate() - 30);
    else if (timeRange === '90d') startTime.setDate(startTime.getDate() - 90);
    else startTime.setDate(startTime.getDate() - 30);
    
    AdminReports.Activities.list('all', 'chrome', {
      maxResults: 1,
      startTime: startTime.toISOString()
    });
    return true;
  } catch (e) {
    throw new Error("API Connection failed: " + e.message);
  }
}

/**
 * Fetches data in chunks (Max 4000 logs per request).
 * Bypasses 6-minute timeout as execution runs briefly per call.
 */
function fetchLogChunk(timeRange, pageToken) {
  try {
    const maxPagesPerExecution = 4;
    let currentToken = pageToken;
    let pagesFetched = 0;
    const chunkLogs = [];

    let startTime = new Date();
    if (timeRange === '7d') startTime.setDate(startTime.getDate() - 7);
    else if (timeRange === '30d') startTime.setDate(startTime.getDate() - 30);
    else if (timeRange === '90d') startTime.setDate(startTime.getDate() - 90);
    else startTime.setDate(startTime.getDate() - 30);

    const optionalArgs = {
      maxResults: 1000,
      startTime: startTime.toISOString()
    };

    do {
      if (currentToken) optionalArgs.pageToken = currentToken;
      
      const response = AdminReports.Activities.list('all', 'chrome', optionalArgs);
      const items = response.items || [];
      
      items.forEach(item => {
        const mapped = mapAdminSdkToRow(item);
        if (mapped) chunkLogs.push(mapped);
      });

      currentToken = response.nextPageToken;
      pagesFetched++;
      
    } while (currentToken && pagesFetched < maxPagesPerExecution);

    return {
      logs: chunkLogs,
      nextPageToken: currentToken || null,
      isComplete: !currentToken
    };
  } catch (e) {
    throw new Error("Failed fetching chunk: " + e.message);
  }
}

/**
 * Maps raw Admin SDK payload to structured analytics row.
 */
function mapAdminSdkToRow(item) {
  const row = {};
  row['Date'] = item.id ? item.id.time : '';
  const actorEmail = item.actor ? item.actor.email : '';
  const events = item.events || [];
  
  if (events.length === 0) return null;
  
  const ev = events[0];
  const params = {};
  (ev.parameters || []).forEach(p => {
    let val = '';
    if (p.value !== undefined) val = p.value;
    else if (p.multiValue !== undefined) val = p.multiValue.join(', ');
    else if (p.intValue !== undefined) val = p.intValue.toString();
    else if (p.boolValue !== undefined) val = p.boolValue.toString();
    else if (p.multiMessageValue !== undefined) {
      let msgVals = [];
      p.multiMessageValue.forEach(msg => {
        (msg.parameter || []).forEach(subP => {
          if (subP.name === 'DETECTOR_NAME') msgVals.push(subP.value);
        });
      });
      val = msgVals.filter(v => v).join(', ');
    }
    params[p.name] = val;
  });

  row['Event reason'] = params['EVENT_REASON'] || ev.name || '';
  const eventReason = row['Event reason'];

  row['Event'] = '';
  if (eventReason === 'CONTENT_MATCHED_SENSITIVE_DATA_TYPES' || eventReason.indexOf('TRANSFER') !== -1) {
    row['Event'] = 'Content was transferred';
  } else if (eventReason.indexOf('UNSAFE') !== -1) {
    row['Event'] = 'Unsafe site visit';
  } else if (eventReason.indexOf('EXTENSION') !== -1) {
    row['Event'] = 'Browser extension modified';
  }

  row['Profile user'] = params['PROFILE_USER_NAME'] || actorEmail;
  row['Web app signed-in account'] = params['WEB_APP_SIGNED_IN_ACCOUNT'] || '';
  
  const url = params['TAB_URL'] || params['URL'] || '';
  row['Domain'] = '';
  row['URL'] = url;
  
  if (url) {
    const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^\/:]+)/i);
    if (match && match[1]) {
      row['Domain'] = match[1].toLowerCase();
    }
  }
  
  row['Detector Name'] = params['MATCHED_DETECTORS'] || '';
  row['URL category'] = params['LOCALIZED_URL_CATEGORY'] || '';
  row['Content size'] = params['CONTENT_SIZE'] || params['SIZE'] || '0';

  const trigger = params['TRIGGER_TYPE'] || params['ACTION'] || params['EVENT_RESULT'] || '';
  const rawTrig = trigger.toUpperCase();
  
  if (rawTrig === 'FILE_UPLOAD' || rawTrig.indexOf('UPLOAD') !== -1) {
    row['Trigger type'] = 'File upload';
  } else if (rawTrig === 'FILE_DOWNLOAD' || rawTrig.indexOf('DOWNLOAD') !== -1) {
    row['Trigger type'] = 'File download';
  } else if (rawTrig === 'PAGE_PRINT' || rawTrig.indexOf('PRINT') !== -1) {
    row['Trigger type'] = 'Page print';
  } else {
    row['Trigger type'] = (eventReason === 'CONTENT_MATCHED_SENSITIVE_DATA_TYPES') ? 'Content transfer' : trigger;
  }

  return row;
}
