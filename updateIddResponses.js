'use strict';
const getSDM = require('../../../mongo/connections/sdm.js');
const collection = require('../../../data/mongocollection');
const Logger = require('../../../../node/utilities/logger-wrapper');
const logger = new Logger('updateIddResponses');
const fileName = process.env.FILE_NAME;
const buyer = process.env.BUYER;
const questionnaire = require('../../../data/idd/' + fileName);

async function responseIddUpdate() {
  const sdm = await getSDM();
  try {
    if (buyer) {
      const user = await sdm.collection(collection.User).findOne({ email: buyer });
      if (user) {
        const userEntity = await sdm
          .collection(collection.UserEntities)
          .findOne({ userID: user._id });
        const relationships = await sdm
          .collection(collection.Relationship)

          .find({
            $and: [
              { invitorID: userEntity.entityID },
              { status: { $nin: ['onboarded', 'rejected', 'offboarded'] } },
            ],
          })
          .toArray();
        if (relationships.length) {
          const relationshipIds = relationships.map((relationship) => relationship._id);
          const responses = await sdm
            .collection(collection.IDDResponse)
            .find({
              'questionnaire.iddID': questionnaire._id,
              relationshipID: { $in: relationshipIds },
              $or: [
                {
                  isSubmitted: {
                    $exists: false,
                  },
                },
                {
                  isSubmitted: false,
                },
              ],
            })
            .toArray();
          for (let i = 0; i < responses.length; i++) {
            try {
              logger.info(`${i + 1} of ${responses.length} for questionnaire ${fileName}`);
              let response = responses[i];
              logger.info(`${JSON.stringify(response)}`);
              let existingResponses = JSON.parse(JSON.stringify(response.questionnaire));

              response.questionnaire = JSON.parse(JSON.stringify(questionnaire));

              response.questionnaire.questions.map((question) => {
                let matchedQuestion = existingResponses.questions.find(
                  (quest) => quest.questionID === question.questionID
                );

                if (matchedQuestion) {
                  if (matchedQuestion.answer) {
                    question.answer = matchedQuestion.answer;
                  }
                  if (matchedQuestion.additionalOptions && matchedQuestion.additionalOptions.answer) {
                    question.additionalOptions.answer = matchedQuestion.additionalOptions.answer;
                  }
                }
              });
              response.questionnaire.iddID = questionnaire._id;

              logger.info(
                `updateIDDResponses(), Message: Replacing response for ${response.relationshipID} `,
                response._id
              );
              let commandResult = await sdm.collection(collection.IDDResponse).deleteOne({
                'questionnaire.iddID': questionnaire._id,
                relationshipID: response.relationshipID,
              });

              logger.debug(
                `updateIDDResponses(), Message: Result of deleting questionnaire response in mongo - ${JSON.stringify(
                  commandResult
                )}`
              );

              commandResult = await sdm.collection(collection.IDDResponse).insertOne(response);

              logger.debug(
                `updateIDDResponses(), Message: Result of inserting questionnaire response in mongo - ${JSON.stringify(
                  commandResult
                )}`
              );
              logger.info('SUCCESS');
            }
            catch (err) {
              logger.error('Error in updating questionnaire response: ', JSON.stringify(err));
            }
          }
        }
      }
    }
  } catch (error) {
    logger.error('Error updating questionnaire responses: ', error);
  } finally {
    // make sure to close connection
    sdm.close();
  }
}

responseIddUpdate();
