'use strict';
const getSDM = require('../../connections/sdm');
const Logger = require('tys-logger-wrapper').Logger;
const logger = new Logger('updateContactTypeManagementContactForSupplier');
const collection = require('../../../data/mongocollection');
const { ContactType } = require('tys-lib');
const { groupBy } = require('lodash');
class MongoUtil {
  async init() {
    this.db = await getSDM();
  }
  async close() {
    this.db.close();
  }
  async findWithProject(schemaName, query, project = {}) {
    return await this.db.collection(schemaName).find(query, project).toArray();
  }
  async updateOne(schemaName, query, newValues) {
    return await this.db.collection(schemaName).updateOne(query, newValues);
  }
  async aggregate(schemaName, pipeline, options) {
    return await this.db.collection(schemaName).aggregate(pipeline, options).toArray();
  }
}
let mongoUtil = new MongoUtil();

async function getBusinessEntities() {
  const matchFilter = {
    $match: {
      entityType: 'S',
    },
  };

  const lookupFilter = {
    $lookup: {
      from: collection.Relationship,
      localField: '_id',
      foreignField: 'inviteeID',
      as: 'relationships',
    },
  };

  const projectFilter = {
    $project: {
      _id: 1,
      companyName: 1,
      managementProfile: '$detailedBusinessInfo.managementProfile',
      relationships: '$relationships',
    },
  };

  const pipeline = [matchFilter, lookupFilter, projectFilter];

  logger.debug('Querying Business entity in mongoDB...');
  return mongoUtil.aggregate(collection.BusinessEntity, pipeline);
}

async function getBusinessEntitiesV2() {
  const inviteeIDs = [
    '11ec9ae01b9df010b35109200cceb0b2',
    '11eb2262cf1f3380b6c0b1f5167550f1',
    '11ec9ae19cecb380b35109200cceb0b2',
  ];
  const queryBusinessEntity = {
    entityType: 'S',
    _id: { $in: inviteeIDs },
  };
  logger.debug(
    `Querying BusinessEntity collection in mongoDB with ${JSON.stringify(queryBusinessEntity)}`
  );
  const businessEntityData = await mongoUtil.findWithProject(
    collection.BusinessEntity,
    queryBusinessEntity,
    {
      _id: 1,
      detailedBusinessInfo: 1,
      companyName: 1,
    }
  );
  const businessEntities = [];
  for (const businessEntity of businessEntityData) {
    const entityID = businessEntity._id;
    logger.info(`Start format data for entity: ${entityID}`);

    const queryRelationship = {
      inviteeID: entityID,
      inviteeContact: { $exists: true },
    };
    logger.debug(
      `Querying Relationship collection in mongoDB with ${JSON.stringify(queryRelationship)}`
    );
    const relationships = await mongoUtil.findWithProject(
      collection.Relationship,
      queryRelationship,
      {
        _id: 1,
        inviteeID: 1,
        inviteeContact: 1,
        status: 1,
      }
    );
    businessEntities.push({
      _id: entityID,
      companyName: businessEntity.companyName,
      managementProfile: businessEntity.detailedBusinessInfo.managementProfile,
      relationships: relationships,
    });
  }
  return businessEntities;
}

async function updateContactTypeManagementContactForSupplier() {
  logger.info('updateContactTypeManagementContactForSupplier()');
  logger.info('init mongoDB');
  await mongoUtil.init();
  try {
    logger.info('Get Business entity in mongoDB');
    // const businessEntities = await getBusinessEntities();
    const businessEntities = await getBusinessEntitiesV2();

    for (const businessEntity of businessEntities) {
      logger.info(
        `Start update management contact type for Company: ${businessEntity.companyName}`
      );
      try {
        const managementProfile = businessEntity.managementProfile;
        if (!managementProfile) {
          logger.info(`No managementProfile found for Company: ${businessEntity.companyName}`);
          continue;
        }

        const relationships = businessEntity.relationships;
        logger.info(`Get inviteeContact for Company: ${businessEntity.companyName}`);
        const relationshipInviteeContacts = [];
        for (const relationship of relationships) {
          if (relationship.inviteeContact) {
            relationship.inviteeContact.forEach((inviteeContact) => {
              inviteeContact.relationshipID = relationship._id;
            });
            relationshipInviteeContacts.push(...relationship.inviteeContact);
          }
        }

        if (relationshipInviteeContacts.length === 0) {
          logger.info(`No invitee contact found for Company: ${businessEntity.companyName}`);
          continue;
        }

        const managementCEOContactID = (managementProfile.ceo && managementProfile.ceo.ids) || [];
        const managementCFOContactID = (managementProfile.cfo && managementProfile.cfo.ids) || [];
        const managementDOSContactID = (managementProfile.dos && managementProfile.dos.ids) || [];
        const managementOtherContactIDs = managementProfile.other || [];

        logger.info(
          `Check and add management contact type inside inviteeContact for Company: ${businessEntity.companyName}`
        );
        relationshipInviteeContacts.forEach((inviteeContact) => {
          if (!Array.isArray(inviteeContact.contactType)) {
            inviteeContact.contactType = [];
          }

          logger.info('Check and add CEO management contact type');
          if (
            inviteeContact.contactID === managementCEOContactID[0] &&
            !inviteeContact.contactType.includes(ContactType.CHIEF_EXECUTIVE_OFFICER_OR_EQUIVALENT)
          ) {
            inviteeContact.contactType.push(ContactType.CHIEF_EXECUTIVE_OFFICER_OR_EQUIVALENT);
          }

          logger.info('Check and add CFO management contact type');
          if (
            inviteeContact.contactID === managementCFOContactID[0] &&
            !inviteeContact.contactType.includes(ContactType.CHIEF_FINANCIAL_OFFICER_OR_EQUIVALENT)
          ) {
            inviteeContact.contactType.push(ContactType.CHIEF_FINANCIAL_OFFICER_OR_EQUIVALENT);
          }

          logger.info('Check and add DOS management contact type');
          if (
            inviteeContact.contactID === managementDOSContactID[0] &&
            !inviteeContact.contactType.includes(ContactType.DIRECTOR_OF_SALE_OR_EQUIVALENT)
          ) {
            inviteeContact.contactType.push(ContactType.DIRECTOR_OF_SALE_OR_EQUIVALENT);
          }

          logger.info('Check and add Other management contact type');
          if (
            managementOtherContactIDs.includes(inviteeContact.contactID) &&
            !inviteeContact.contactType.includes(ContactType.OTHER_MANAGEMENT)
          ) {
            inviteeContact.contactType.push(ContactType.OTHER_MANAGEMENT);
          }
        });

        const groupRelationshipInviteeContactsByID = groupBy(
          relationshipInviteeContacts,
          'relationshipID'
        );

        for (let relationshipID in groupRelationshipInviteeContactsByID) {
          const relationshipInviteeContacts = groupRelationshipInviteeContactsByID[relationshipID];
          //delete relationshipID after group inviteeContacts
          relationshipInviteeContacts.forEach((inviteeContact) => {
            delete inviteeContact.relationshipID;
          });

          const commandResult = await mongoUtil.updateOne(
            collection.Relationship,
            { _id: relationshipID },
            {
              $set: {
                inviteeContact: relationshipInviteeContacts,
              },
            }
          );
          logger.info(
            `Result after update inviteeContact relationship: ${JSON.stringify(commandResult)}`
          );
        }
      } catch (err) {
        logger.info(`ERROR, Message: ${err.message}, Stack: ${err.stack}`);
      }
    }
  } catch (err) {
    logger.info(`ERROR, Message: ${err.message}, Stack: ${err.stack}`);
  } finally {
    mongoUtil.close();
    process.exit();
  }
}

updateContactTypeManagementContactForSupplier();
