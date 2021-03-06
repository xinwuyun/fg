import { FunctionGraphClient } from "./functionGraph/FunctionGraphClient";
import { CreateTriggerRequest } from "./functionGraph/model/CreateTriggerRequest";
import { CreateTriggerRequestBody } from "./functionGraph/model/CreateTriggerRequestBody";
import { ListTriggerRequest } from "./functionGraph/model/ListTriggerRequest";
import { UpdateTriggerRequest } from "./functionGraph/model/UpdateTriggerRequest";
import { UpdateTriggerRequestBody } from "./functionGraph/model/UpdateTriggerRequestBody";
import logger from "../../common/logger";
import { DeleteTriggerRequest } from "./functionGraph/model/DeleteTriggerRequest";
import * as core from '@serverless-devs/core'
const { setState, getState } = require("@serverless-devs/core");


export const TRIGGER_TYPE_CODES = [
  "SMN",
  "APIG",
  "OBS",
  "TIMER",
  "DMS",
  "DIS",
  "LTS",
  "DDS",
  "CTS",
  "kafka",
];
export const STATUSES = ["ACTIVE", "DISABLED"];

export interface TriggerInputProps {
  triggerId?: string;
  triggerTypeCode: string;
  eventTypeCode: string;
  status: string;
  functionUrn?: string;
}

export interface LocalTriggerInfo {
  triggerId: string;
  triggerTypeCode: string;
  functionUrn: string;
}

interface SMNEventData {
  topicUrn: string; //SMN服务的topic_urn，创建时必填。唯一
  subscriptionStatus: string; //topic_urn的订阅状态：Unconfirmed / Confirmed。
}

interface CTSEventData {
  name: string;
  operations: string;
}

interface DDSEventData {
  instanceId: string;
  collectionName: string;
  dbName: string;
  dbPassword: string;
  batchSize: Array<string>;
}

interface KAFKAEventData {
  instance_id: string;
  db_name: string;
  collection_name: string;
  db_user: string;
  db_password: string;
  batch_size: number;
}

interface DISEventData {
  streamName: string;
  sharditeratorType: string;
  batchSize?: number;
  pollingInterval?: number;
}

interface APIGEventData {
  groupId: string;
  envId: string;
  auth: string;
  protocol: string;
  name: string;
  path: string;
  matchMode: string;
  reqMethod: string;
  backendType: string;
  type: number;
  slDomain: string;
  instanceId: string;
}

interface LTSEventData {
  groupId: string;
  topicId: string;
}

interface TIMEREventData {
  name: string;
  scheduleType: string;
  schedule: string;
  userEvent?: string;
}

interface OBSEventData {
  bucket: string;
  events: Array<string>;
  prefix?: string;
  suffix?: string;
}

interface OBSEventData {
  bucket: string;
  events: Array<string>;
  prefix?: string;
  suffix?: string;
}

// interface DMSEventData {
//     queueId: string,
//     consumerGroupId: string
// }

// export class TriggerDMS extends Trigger{
//     public eventData: DMSEventData;

//     public constructor(input: TriggerInputProps, eventData: DMSEventData) {
//         super(input);
//         this['eventData'] = eventData;
//     }

//     public getEventData():object {
//         return this.eventData;
//     }
// }

export abstract class Trigger {
  public triggerId?: string;
  public triggerTypeCode: string;
  public eventTypeCode: string;
  public status: string;
  public functionUrn?: string;
  public constructor(input: TriggerInputProps) {
    const { triggerId, triggerTypeCode, eventTypeCode, status, functionUrn } =
      input;

    if (TRIGGER_TYPE_CODES.indexOf(triggerTypeCode) < 0) {
      throw new Error("Invalid triggerTypeCode.");
    }
    if (STATUSES.indexOf(status) < 0) {
      throw new Error(`Invalid status, only accept "DISABLED" and "ACTIVE".`);
    }

    this["triggerId"] = triggerId;
    this["triggerTypeCode"] = triggerTypeCode;
    this["status"] = status;
    this["eventTypeCode"] = eventTypeCode;
    this["functionUrn"] = functionUrn;
  }
  abstract getEventData(): object;

  /**
   * 创建触发器
   * @param client {FunctionGraphClient}
   * @returns res {Object} 函数信息
   * @returns functionUrn {string} 函数Urn
   */
  public async create(client: FunctionGraphClient): Promise<any> {
    const body = new CreateTriggerRequestBody()
      .withTriggerTypeCode(this.triggerTypeCode)
      .withTriggerStatus(this.status)
      .withEventTypeCode(this.eventTypeCode)
      .withEventData(this.getEventData());
   
    logger.debug(JSON.stringify(Object.assign({}, body)));
    const vm = core.spinner("Checking if trigger exists...");
    const response = await client.createTrigger(
      new CreateTriggerRequest()
        .withFunctionUrn(this.functionUrn)
        .withBody(body)
    );
    logger.debug(JSON.stringify(response.data));
    if (response.status !== 200) {
      if(response.data.error_code === "FSS.1148"){ // 该错误码时，触发器重复，尝试更新触发器。
        vm.succeed("Trigger is already online.")
        return await this.update(client);
      }else{
        vm.succeed(`New trigger.`);
        const vm1 = core.spinner("Creating trigger...");
        vm1.fail("Creating trigger failed.");
        logger.error(response.data.error_msg);
      }
    } else {
      vm.succeed(`New trigger.`);
      const vm1 = core.spinner("Creating trigger...");
      const triggerId = response.data.trigger_id;
      const triggerTypeCode = response.data.trigger_type_code;
      const functionUrn = this.functionUrn;
      logger.debug(`triggerId:${triggerId}`);
      await this.setLocalTriggerInfo({triggerId, triggerTypeCode, functionUrn});
      vm1.succeed("Creating trigger successfully.");
      return this.handleResponse(response.data);
    }
  }

  /**
   * 获取触发器列表
   * @param client
   * @returns triggers {Array<any>} 该函数下的所有函数信息
   */
  public async list(client: FunctionGraphClient): Promise<Array<any>> {
    const response = await client.listTrigger(
      new ListTriggerRequest().withFunctionUrn(this.functionUrn)
    );
    if (response.status !== 200) {
      throw new Error(JSON.stringify(response.data));
    } else {
      return response.data;
    }
  }

  /**
   * 更新触发器，只能更新status
   * @param Client
   * @param functionUrn
   * @returns
   */
  public async update(client: FunctionGraphClient): Promise<any> {
    const body = new UpdateTriggerRequestBody().withTriggerStatus(this.status);

    logger.warning("Updating trigger, only support updating status.");
    const triggerId = await this.getTriggerId(client) || (await this.getLocalTriggerInfo()).triggerId;
    if(!triggerId){
      logger.debug("没找到是哪个trigger");
      return;
    }
    const vm = core.spinner("Updating trigger...");
    const response = await client.updateTrigger(
      new UpdateTriggerRequest()
        .withTriggerId(triggerId)
        .withFunctionUrn(this.functionUrn)
        .withTriggerTypeCode(this.triggerTypeCode)
        .withBody(body)
    );
    if (response.status !== 200) {
      //TODO:需要更友好的错误输出
      // throw new Error(JSON.stringify(response.data));
      logger.debug(JSON.stringify(response.data));
      vm.fail("Failed to update trigger.");
      logger.error(response.data.error_msg);
      return;
    } else {
      vm.succeed("Update trigger successfully.");
      return this.handleResponse(response.data);
    }
  }

  /**
   * 删除触发器
   * @param client
   */
  public async remove(client: FunctionGraphClient): Promise<any> {
    let triggerId: string;
    let triggerTypeCode: string;
    let functionUrn = this.functionUrn;
    const vm = core.spinner("Deleting trigger...");
    if (!this.triggerId) {
      const localTriggerInfo = await this.getLocalTriggerInfo();
      triggerId = localTriggerInfo.triggerId;
      triggerTypeCode = localTriggerInfo.triggerTypeCode;
      functionUrn = localTriggerInfo.functionUrn;
      logger.debug(localTriggerInfo);
      // 如果没有本地记录直接返回
      if(!triggerId) {
        vm.fail("Failed to delete trigger, not trigger found local.");
        return;
      }
    } else {
      triggerId = this.triggerId;
      triggerTypeCode = triggerTypeCode;
    }
    const deleteTriggerRequest = new DeleteTriggerRequest()
      .withFunctionUrn(functionUrn)
      .withTriggerId(triggerId)
      .withTriggerTypeCode(triggerTypeCode);
    const response = await client.deleteTrigger(deleteTriggerRequest);
    if (response.status !== 200) {
      vm.fail("Failed to delete trigger, not trigger found local.");
      logger.error("Deleting trigger failed, error message: " + JSON.stringify(response.data));
    } else {
      vm.succeed("Trigger deleted.")
      return response.data;
    }
  }

  /**
   * 设置triggerId,某些业务（目前仅更新需要调用
   * 中需要调用该方法)
   * 先获得本地triggerId
   * 再调用templateMethod获得可能的triggerId
   * @returns
   */
  public async setTriggerId(triggerId?: string) {
    const Id = triggerId || (await getState("state")).postTrigger.triggerId;
    this.triggerId = Id;
  }

  /**
   * 设置本地触发器信息
   */
  public async setLocalTriggerInfo(localTriggerInfo: LocalTriggerInfo) {
    setState("localTriggerInfo", localTriggerInfo);
  }

  /**
   * 获取本地触发器信息
   */
  public async getLocalTriggerInfo(): Promise<LocalTriggerInfo> {
    return await getState("localTriggerInfo");
  }

  /**
   * 暂时不使用
   * 虚函数，每个触发器根据信息获取触发器ID
   * @param client
   */
  abstract getTriggerId(client: FunctionGraphClient): Promise<string>;

  /**
   * 处理返回
   * @param response
   * @returns
   */
  public handleResponse(response) {
    let triggerInfo = [
      {
        desc: "TriggerId",
        example: response.trigger_id,
      },
      {
        desc: "TriggerTypeCode",
        example: response.trigger_type_code,
      },
      {
        desc: "TriggerStatus",
        example: response.trigger_status,
      },
    ];
    let eventDataInfo = [];
    for (let key of Object.keys(response.event_data)) {
      const desc = key;
      let example = response.event_data[key];
      if(typeof(example) === "string") {
        // example = JSON.stringify(example);
        eventDataInfo.push({
          desc,
          example,
        });
      }
      
    }
    return [
      {
        header: "Trigger",
        content: triggerInfo,
      },
      {
        header: "Trigger event data",
        content: eventDataInfo,
      },
    ];
  }
}

export class TriggerSMN extends Trigger {
  public eventData: SMNEventData;

  public constructor(input: TriggerInputProps, eventData: SMNEventData) {
    super(input);
    this["eventData"] = eventData;
  }

  public getEventData(): object {
    return this.eventData;
  }

  public async getTriggerId(client: FunctionGraphClient): Promise<string> {
    const topicUrn = this.eventData.topicUrn;
    const trigger = (await this.list(client)).find((trigger) => {
      return trigger.event_data.topic_urn == topicUrn;
    });
    if (trigger.trigger_id) {
      this.triggerId = trigger.trigger_id;
      return this.triggerId;
    } else {
      return null;
    }
  }
}

export class TriggerDIS extends Trigger {
  public eventData: DISEventData;

  public constructor(input: TriggerInputProps, eventData: DISEventData) {
    super(input);
    this["eventData"] = eventData;
  }

  public getEventData(): object {
    return this.eventData;
  }

  public async getTriggerId(client: FunctionGraphClient): Promise<string> {
    if (this.triggerId) {
      return this.triggerId;
    }
    const triggers = await this.list(client);
    const eventData = this.eventData;
    const trigger = triggers.find((trigger) => {
      return trigger.event_data.streamName == eventData.streamName;
    });
    if (trigger.trigger_id) {
      this.triggerId = trigger.trigger_id;
      return this.triggerId;
    } else {
      return null;
    }
  }
}

export class TriggerAPIG extends Trigger {
  public eventData: APIGEventData;

  public constructor(input: TriggerInputProps, eventData: APIGEventData) {
    super(input);
    this["eventData"] = eventData;
  }

  public getEventData(): object {
    return this.eventData;
  }

  public async getTriggerId(client: FunctionGraphClient): Promise<string> {
    if (this.triggerId) {
      return this.triggerId;
    }
    const triggers = await this.list(client);
    const eventData = this.eventData;
    const trigger = triggers.find((trigger) => {
      return (
        trigger.event_data.streamName === eventData.groupId &&
        trigger.event_data.env_id === eventData.envId
      );
    });
    if (trigger.trigger_id) {
      this.triggerId = trigger.trigger_id;
      return this.triggerId;
    } else {
      return null;
    }
  }
}

export class TriggerTIMER extends Trigger {
  public eventData: TIMEREventData;

  public constructor(input: TriggerInputProps, eventData: TIMEREventData) {
    super(input);
    this["eventData"] = eventData;
  }

  public getEventData(): object {
    return this.eventData;
  }

  public async getTriggerId(client: FunctionGraphClient): Promise<string> {
    if (this.triggerId) {
      return this.triggerId;
    }
    const triggers = await this.list(client);
    const eventData = this.eventData;
    const trigger = triggers.find((trigger) => {
      return trigger.event_data.name === eventData.name;
    });
    if (trigger.trigger_id) {
      this.triggerId = trigger.trigger_id;
      return this.triggerId;
    } else {
      return null;
    }
  }
}

export class TriggerLTS extends Trigger {
  public eventData: LTSEventData;

  public constructor(input: TriggerInputProps, eventData: LTSEventData) {
    super(input);
    this["eventData"] = eventData;
  }

  public getEventData(): object {
    return this.eventData;
  }

  public async getTriggerId(client: FunctionGraphClient): Promise<string> {
    if (this.triggerId) {
      return this.triggerId;
    }
    const triggers = await this.list(client);
    const eventData = this.eventData;
    const trigger = triggers.find((trigger) => {
      return (
        trigger.event_data.group_id === eventData.groupId &&
        trigger.event_data.topic_id === eventData.topicId
      );
    });
    if (trigger.trigger_id) {
      this.triggerId = trigger.trigger_id;
      return this.triggerId;
    } else {
      return null;
    }
  }
}

export class TriggerOBS extends Trigger {
  public eventData: OBSEventData;

  public constructor(input: TriggerInputProps, eventData: OBSEventData) {
    super(input);
    this["eventData"] = eventData;
  }

  public getEventData(): object {
    return this.eventData;
  }

  public async getTriggerId(client: FunctionGraphClient): Promise<string> {
    if (this.triggerId) {
      return this.triggerId;
    }
    const triggers = await this.list(client);
    const eventData = this.eventData;

    const trigger = triggers.find((trigger) => {
      return (
        trigger.event_data.bucket === eventData.bucket &&
        trigger.event_data.prefix === eventData.prefix &&
        trigger.event_data.suffix === eventData.suffix
      );
    });
    if (trigger.trigger_id) {
      this.triggerId = trigger.trigger_id;
      return this.triggerId;
    } else {
      return null;
    }
  }
}

export class TriggerCTS extends Trigger {
  public eventData: CTSEventData;

  public constructor(input: TriggerInputProps, eventData: CTSEventData) {
    super(input);
    this["eventData"] = eventData;
  }

  public getEventData(): object {
    return this.eventData;
  }

  public async getTriggerId(client: FunctionGraphClient): Promise<any> {
    return null;
  }
}

export class TriggerDDS extends Trigger {
  public eventData: DDSEventData;

  public constructor(input: TriggerInputProps, eventData: DDSEventData) {
    super(input);
    this["eventData"] = eventData;
  }

  public getEventData(): object {
    return this.eventData;
  }

  public async getTriggerId(client: FunctionGraphClient): Promise<any> {
    return null;
  }
}

export class TriggerKAFKA extends Trigger {
  public eventData: KAFKAEventData;

  public constructor(input: TriggerInputProps, eventData: KAFKAEventData) {
    super(input);
    this["eventData"] = eventData;
  }

  public getEventData(): object {
    return this.eventData;
  }

  public async getTriggerId(client: FunctionGraphClient): Promise<any> {
    return null;
  }
}

export class TriggerClientFactory {
  public triggerInputProps: TriggerInputProps;
  public eventData: any;

  public constructor(props, functionUrn?: string) {
    this.triggerInputProps = {
      triggerTypeCode: props.trigger.triggerTypeCode,
      eventTypeCode: props.trigger.eventTypeCode,
      status: props.trigger.status || "ACTIVE",
      functionUrn: functionUrn,
      triggerId: props.trigger.triggerId || null,
    };
    this.eventData = props.trigger.eventData;
  }

  public setFunctionUrn(functionUrn: string) {
    this.triggerInputProps.functionUrn = functionUrn;
  }

  public create(): Trigger {
    const triggerTypeCode = this.triggerInputProps.triggerTypeCode;
    const eventData = this.eventData;
    if (triggerTypeCode === "DDS") {
      return new TriggerDDS(this.triggerInputProps, eventData);
    } else if (triggerTypeCode === "CTS") {
      return new TriggerCTS(this.triggerInputProps, eventData);
    } else if (triggerTypeCode === "APIG") {
      return new TriggerAPIG(this.triggerInputProps, eventData);
    } else if (triggerTypeCode === "DIS") {
      return new TriggerDIS(this.triggerInputProps, eventData);
    } else if (triggerTypeCode === "KAFAKA") {
      return new TriggerKAFKA(this.triggerInputProps, eventData);
    } else if (triggerTypeCode === "LTS") {
      return new TriggerLTS(this.triggerInputProps, eventData);
    } else if (triggerTypeCode === "OBS") {
      return new TriggerOBS(this.triggerInputProps, eventData);
    } else if (triggerTypeCode === "SMN") {
      return new TriggerSMN(this.triggerInputProps, eventData);
    } else if (triggerTypeCode === "TIMER") {
      return new TriggerTIMER(this.triggerInputProps, eventData);
    } else {
      logger.error("Unsupported trigger type.");
    }
  }
}
