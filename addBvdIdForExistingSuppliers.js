/*
 * Author: Pritam Kundilya/Amir Ghodi
 * Description: added bvdId for existing suppliers
 */
'use strict';
const OrderedUUID = require('ordered-uuid');
const Logger = require('tys-logger-wrapper').Logger;
const logger = new Logger('addBvdIDforExistingSuppliers');
var MongoClient = require('mongodb').MongoClient;
const collection = require('../../../data/mongocollection.js');
const config = require('../../../../config/config').config;
const fetch = require('node-fetch');

let sdmDb;
let sdmMasterDB;

async function run() {
  if (!process.env.API_TOKEN) {
    logger.error('Api Token is required');
    process.exit();
  }
  if (!process.env.PARTNERID) {
    logger.error('PartnerID is required');
    process.exit();
  }
  const partnerID = process.env.PARTNERID;
  const apiToken = process.env.API_TOKEN;
  const ThirdPartyIdentifiers = 'ThirdPartyIdentifiers';
  sdmDb = await MongoClient.connect(config.database.connectionString);
  sdmMasterDB = await MongoClient.connect(config.database.masterConnectionString);
  try {
    let businessEntitiesSdmMasterData = await sdmMasterDB
      .collection(collection.BusinessEntity)
      .find({ entityType: 'S' })
      .toArray();
    logger.info(`businessEntitiesSdmMasterData count:${businessEntitiesSdmMasterData.length}`);
    for (let supplier of businessEntitiesSdmMasterData) {
      logger.info(`SUPPLIER_ID:${supplier._id}`);
      try {
        // check for this supplier in thirdPartyIndentifiers collection
        const thirdPartyIdentifier = await sdmDb
          .collection(ThirdPartyIdentifiers)
          .findOne({ supplierId: supplier._id });

        logger.info(`thirdPartyIdentifiers :${JSON.stringify(thirdPartyIdentifier)}`);
        if (!thirdPartyIdentifier) {
          // make moodys api call
          logger.info('making moodys api call ...');
          const records = await moodysApiCall(supplier, apiToken);
          if (records.length === 1) {
            logger.info(
              `Moodys unique record found for this supplierId:${
                supplier._id
              } records: ${JSON.stringify(records)}`
            );
            // create new thirdPartyIdentifier data
            let thirdPartyIdentifierDto = {
              _id: OrderedUUID.generate(),
              supplierId: supplier._id,
              identifiers: [
                {
                  partnerId: partnerID,
                  identifierId: records[0].BvDId,
                },
              ],
              createdDate: new Date(),
              createdBy: 'system',
            };
            logger.info(
              `creating new thirdPartyIdentifier with thirdPartyIdentifierDto: ${JSON.stringify(
                thirdPartyIdentifierDto
              )}`
            );
            await sdmDb.collection(ThirdPartyIdentifiers).insertOne(thirdPartyIdentifierDto);
            logger.info(`created new thirdPartyIdentifier for id: ${supplier._id}`);
          } else if (records.length === 0) {
            logger.info(
              `Moodys no records found: ${JSON.stringify(records)} & supplier legal name: ${
                supplier.legalName
              } & taxCountry: ${supplier.taxCountry}`
            );
          }
        }
      } catch (error) {
        logger.error(
          `Error in forloop for supplierId: ${supplier._id}: ${JSON.stringify(error.stack)}`
        );
      }
    }
  } catch (err) {
    logger.error(`Error: ${JSON.stringify(err.stack)}`);
  } finally {
    await sdmDb.close();
    await sdmMasterDB.close();
    process.exit();
  }
}

async function moodysApiCall(supplier, apiToken) {
  const headQuarterAddress = supplier.addresses.find((obj) => obj.addressType === 'Headquarters');
  logger.info(`supplier headquarters address:${JSON.stringify(headQuarterAddress)} `);
  if (!headQuarterAddress && !supplier.detailedBusinessInfo.taxProfile) {
    logger.info(
      `supplier headquarters address & taxProfile not found for supplierId:${supplier._id} and supplier name: ${supplier.legalName}`
    );
    return [];
  }
  let payload = {
    companyName: supplier.companyName,
    legalName: supplier.legalName,
    headQuarterAddress: headQuarterAddress,
    taxProfile: supplier.detailedBusinessInfo.taxProfile,
  };
  logger.info(`payload created for api call:${JSON.stringify(payload)}`);
  let records = [];
  if (supplier.detailedBusinessInfo.taxProfile) {
    logger.info('Tax Profile exists...');
    // search with all params
    logger.info('Querying with all params except address...');
    records = await fetchMatches(payload, apiToken, []);
    logger.info(`Moodys records count :${records.length}`);
    if (records.length === 1) {
      return records;
    } else if (records.length > 1) {
      logger.info(
        `multiple match records count:${records.length} multiple match records: ${records.length}`
      );
      const selectedRecords = records.filter((obj) => obj.Hint === 'Selected');
      logger.info(`Hint=selected match records count:${selectedRecords.length}`);
      if (selectedRecords.length === 1) return selectedRecords;
    } else {
      // search without address & city
      logger.info('Querying with all params except (address,city)...');
      records = await fetchMatches(payload, apiToken, ['address', 'city']);
      logger.info(`Moodys match records count:${records.length}`);
      if (records.length === 1) {
        return records;
      } else if (records.length > 1) {
        logger.info(
          `multiple match records count:${records.length} multiple match records: ${records.length}`
        );
        const selectedRecords = records.filter((obj) => obj.Hint === 'Selected');
        logger.info(`Hint=selected match records count:${selectedRecords.length}`);
        if (selectedRecords.length === 1) return selectedRecords;
      } else {
        // search without postal code
        logger.info('Querying with all params except (address,city,postCode)...');
        records = await fetchMatches(payload, apiToken, ['postCode']);
        logger.info(`Moodys match records count:${records.length}`);
        if (records.length === 1) {
          return records;
        } else if (records.length > 1) {
          logger.info(
            `multiple match records count:${records.length} multiple match records: ${records.length}`
          );
          const selectedRecords = records.filter((obj) => obj.Hint === 'Selected');
          logger.info(`Hint=selected match records count:${selectedRecords.length}`);
          if (selectedRecords.length === 1) return selectedRecords;
        } else {
          //make address search
          logger.info('Querying with all params except (nationalId)...');
          records = await fetchMatches(payload, apiToken, ['nationalID']);
          logger.info(`Moodys records count :${records.length}`);
          if (records.length === 1) {
            return records;
          } else if (records.length > 1) {
            logger.info(
              `multiple match records count:${records.length} multiple match records: ${records.length}`
            );
            const selectedRecords = records.filter((obj) => obj.Hint === 'Selected');
            logger.info(`Hint=selected match records count:${selectedRecords.length}`);
            if (selectedRecords.length === 1) return selectedRecords;
          }
        }
      }
    }
  } else {
    //make address search
    logger.info('Tax Profile does not exists...');
    logger.info('Querying with all params except (nationalId)...');
    records = await fetchMatches(payload, apiToken, ['nationalID']);
    logger.info(`Moodys records count :${records.length}`);
    if (records.length === 1) {
      return records;
    } else if (records.length > 1) {
      logger.info(
        `multiple match records count:${records.length} multiple match records: ${records.length}`
      );
      const selectedRecords = records.filter((obj) => obj.Hint === 'Selected');
      logger.info(`Hint=selected match records count:${selectedRecords.length}`);
      if (selectedRecords.length === 1) return selectedRecords;
    }
  }
  return records;
}

async function buildMatchQuery(payload, removedSearchParams, logger) {
  let MatchCriteria = {};
  if (removedSearchParams.length === 0) {
    MatchCriteria = {
      City: payload.headQuarterAddress.city,
      Country: payload.headQuarterAddress.country,
      Name: payload.companyName,
      PostCode: payload.headQuarterAddress.postalCode || '',
    };
    const nationalId = await getNationalIdfromTaxProfile(payload.taxProfile, logger);
    if (nationalId) {
      MatchCriteria.NationalId = nationalId;
    } else {
      logger.info('taxProfile exists: No national Id present');
    }
    logger.info(
      `taxProfile exists: match criteria with all query inputs : ${JSON.stringify(MatchCriteria)}`
    );
  } else {
    if (removedSearchParams.includes('address') && removedSearchParams.includes('city')) {
      MatchCriteria = {
        Country: payload.headQuarterAddress.country,
        Name: payload.companyName,
        PostCode: payload.headQuarterAddress.postalCode || '',
      };
      const nationalId = await getNationalIdfromTaxProfile(payload.taxProfile, logger);
      if (nationalId) {
        MatchCriteria.NationalId = nationalId;
      }
      MatchCriteria.NationalId = nationalId;
      logger.info(
        `taxProfile exists: match criteria without (Address,City) inputs: ${JSON.stringify(
          MatchCriteria
        )}`
      );
    }
    if (removedSearchParams.includes('postCode')) {
      MatchCriteria = {
        Country: payload.headQuarterAddress.country,
        Name: payload.companyName,
      };
      const nationalId = await getNationalIdfromTaxProfile(payload.taxProfile, logger);
      if (nationalId) {
        MatchCriteria.NationalId = nationalId;
      }
      MatchCriteria.NationalId = nationalId;
      logger.info(
        `taxProfile exists: match criteria without (Address,City,PostCode) inputs: ${JSON.stringify(
          MatchCriteria
        )}`
      );
    }
    if (removedSearchParams.includes('nationalID')) {
      // address search with Name, Country, Address, City, PostCode
      MatchCriteria = {
        City: payload.headQuarterAddress.city,
        Country: payload.headQuarterAddress.country,
        Name: payload.companyName,
        PostCode: payload.headQuarterAddress.postalCode || '',
      };
      MatchCriteria.Address =
        payload.headQuarterAddress.street1 + ' ' + payload.headQuarterAddress.street2;
      logger.info(
        `only address search: match criteria with (Address, City ,Postcode ,Name ,Country)  inputs: ${JSON.stringify(
          MatchCriteria
        )}`
      );
    }
  }

  let MatchOptions = {
    ScoreLimit: 0.95,
    ExclusionFlags: ['ExcludeBranchLocations'],
  };
  let requiredFields = [
    'Match.Hint',
    'Match.Score',
    'Match.Name',
    'Match.Name_Local',
    'Match.MatchedName',
    'Match.MatchedName_Type',
    'Match.Address',
    'Match.Postcode',
    'Match.City',
    'Match.Country',
    'Match.Address_Type',
    'Match.PhoneOrFax',
    'Match.EmailOrWebsite',
    'Match.National_Id',
    'Match.NationalIdLabel',
    'Match.State',
    'Match.Region',
    'Match.LegalForm',
    'Match.ConsolidationCode',
    'Match.Status',
    'Match.Ticker',
    'Match.CustomRule',
    'Match.Isin',
    'Match.BvDId',
  ];

  const requestData = {
    MATCH: {
      Criteria: MatchCriteria,
      Options: MatchOptions,
    },
    SELECT: requiredFields,
  };

  return requestData;
}

async function fetchMatches(payload, apiToken, removedSearchParams) {
  let url = 'https://api.bvdinfo.com/v1/orbis/companies/match';
  let response = [];
  // fetch api data with nationalId without address
  const matchQuery = await buildMatchQuery(payload, removedSearchParams, logger);
  logger.info(`MATCH_QUERY for api call: ${JSON.stringify(matchQuery)}`);
  response = await fetch.default(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ApiToken: apiToken,
    },
    body: JSON.stringify(matchQuery),
  });

  logger.info(
    'URL to fetch Moodys data: ' + url + '  \nResponse statusText: ' + response.statusText
  );

  response = await response.json();
  return response;
}

async function getNationalIdfromTaxProfile(taxProfileData, logger) {
  let nationalId = '';
  if (taxProfileData) {
    // discard businessType, othersBusinessType, dunsNumber
    ['dunsNumber', 'othersBusinessType', 'businessType'].forEach((e) => delete taxProfileData[e]);
    // take values with type string
    for (const [key, value] of Object.entries(taxProfileData)) {
      if (value && typeof value === 'string') {
        nationalId += value + '|';
      }
    }
    // remove last | from nationalId
    nationalId = nationalId.replace(/.$/, '');
    logger.info(`nationalID string: ${nationalId}`);
    return nationalId;
  } else {
    return nationalId;
  }
}
run();
